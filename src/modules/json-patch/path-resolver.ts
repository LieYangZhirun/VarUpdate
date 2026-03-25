/**
 * modules/json-patch/path-resolver.ts
 *
 * 反向路径解析器 —— VarUpdate 核心算法
 *
 * 传统正向解析从根节点逐层向下查找，路径中任何一层不存在即报错。
 * 本模块采用反向策略：从路径的叶子键名反向搜索，逐级消歧义，
 * 最大程度容忍 AI 模型在中间路径层级上的错误。
 *
 * 算法步骤：
 * 1. 提取叶子键名 → 全局搜索候选集
 * 2. 用路径中的父节点段逐级过滤
 * 3. 唯一匹配 → 确定目标路径
 */

import { findAllPaths, getValueByPath, parsePath } from '../../shared/path-utils.js';

// ═══════════════════════════════════════════
//  公开类型
// ═══════════════════════════════════════════

export interface ResolvedPath {
  /** 原始路径（指令中的路径） */
  original: string;
  /** 解析后的实际路径（在变量状态中的完整路径） */
  resolved: string;
  /** 是否进行了路径修正 */
  corrected: boolean;
}

export interface PathResolveError {
  original: string;
  reason: string;
}

// ═══════════════════════════════════════════
//  主入口
// ═══════════════════════════════════════════

/**
 * 反向解析指令路径，找到变量状态中的唯一匹配位置
 *
 * @param instructionPath 指令中的路径（AI 生成，可能不精确）
 * @param currentData 当前变量状态
 * @param op 操作类型（insert 时路径不存在是正常的）
 * @returns 解析结果或错误
 */
export function resolvePath(
  instructionPath: string,
  currentData: Record<string, any>,
  op: 'replace' | 'insert' | 'delete'
): ResolvedPath | PathResolveError {
  const segments = parsePath(instructionPath);

  if (segments.length === 0) {
    return { original: instructionPath, reason: '空路径' };
  }

  const leafKey = segments[segments.length - 1];

  // ─── 特殊情况：数组末尾追加 ───
  if (leafKey === '-') {
    // 解析 "-" 之前的部分
    const parentPath = segments.slice(0, -1).join('/');
    const parentResult = resolveParentPath(parentPath, currentData);
    if ('reason' in parentResult) {
      return parentResult;
    }
    return {
      original: instructionPath,
      resolved: parentResult.resolved + '/-',
      corrected: parentResult.corrected,
    };
  }

  // ─── 特殊情况：数组索引结尾 ───
  if (/^\d+$/.test(leafKey)) {
    // 数字段不参与反向搜索的键名匹配
    // 解析数字段之前的部分，然后附上索引
    const parentSegments = segments.slice(0, -1);
    if (parentSegments.length === 0) {
      // 路径仅为数字 → 直接返回
      return { original: instructionPath, resolved: instructionPath, corrected: false };
    }
    const parentPath = parentSegments.join('/');
    const parentResult = resolveParentPath(parentPath, currentData);
    if ('reason' in parentResult) {
      return parentResult;
    }
    return {
      original: instructionPath,
      resolved: parentResult.resolved + '/' + leafKey,
      corrected: parentResult.corrected,
    };
  }

  // ─── 第一步：提取叶子键名，全局搜索候选集 ───
  const candidates = findAllPaths(currentData, leafKey);

  // ─── 候选集为空 ───
  if (candidates.length === 0) {
    if (op === 'insert') {
      // insert 操作：路径不存在视为正常新增
      // 尝试解析父路径
      if (segments.length > 1) {
        const parentPath = segments.slice(0, -1).join('/');
        const parentResult = resolveParentPath(parentPath, currentData);
        if ('reason' in parentResult) {
          // 父路径也不存在 → 使用原始路径
          return { original: instructionPath, resolved: instructionPath, corrected: false };
        }
        return {
          original: instructionPath,
          resolved: parentResult.resolved + '/' + leafKey,
          corrected: parentResult.corrected,
        };
      }
      // 顶层新增
      return { original: instructionPath, resolved: instructionPath, corrected: false };
    }
    return { original: instructionPath, reason: `叶子键名 "${leafKey}" 在变量状态中不存在` };
  }

  // ─── 唯一匹配 → 直接返回 ───
  if (candidates.length === 1) {
    const resolved = candidates[0];
    return {
      original: instructionPath,
      resolved,
      corrected: resolved !== instructionPath,
    };
  }

  // ─── 第二步：逐级消歧义 ───
  let filtered = [...candidates];

  // 从倒数第二段开始逐级过滤
  for (let i = segments.length - 2; i >= 0 && filtered.length > 1; i--) {
    const ancestorKey = segments[i];

    // 跳过数字段（数组索引不参与消歧义键名匹配）
    if (/^\d+$/.test(ancestorKey)) continue;

    filtered = filtered.filter(candidatePath => {
      const candidateSegments = parsePath(candidatePath);
      // 检查候选路径中是否包含这个祖先键名
      return candidateSegments.includes(ancestorKey);
    });
  }

  // ─── 消歧义结果 ───
  if (filtered.length === 1) {
    const resolved = filtered[0];
    return {
      original: instructionPath,
      resolved,
      corrected: resolved !== instructionPath,
    };
  }

  if (filtered.length === 0) {
    return { original: instructionPath, reason: `路径 "${instructionPath}" 的消歧义过滤后无匹配` };
  }

  // 仍有多个匹配 → 尝试精确匹配原始路径
  const exactMatch = filtered.find(c => c === instructionPath);
  if (exactMatch) {
    return { original: instructionPath, resolved: exactMatch, corrected: false };
  }

  return { original: instructionPath, reason: `路径 "${instructionPath}" 歧义：找到 ${filtered.length} 个匹配` };
}

/**
 * 解析路径的父路径部分（用于 insert 和数组索引场景）
 */
function resolveParentPath(
  parentPath: string,
  currentData: Record<string, any>
): ResolvedPath | PathResolveError {
  // 先尝试正向查找
  const directValue = getValueByPath(currentData, parentPath);
  if (directValue !== undefined) {
    return { original: parentPath, resolved: parentPath, corrected: false };
  }

  // 正向失败 → 用反向解析
  return resolvePath(parentPath, currentData, 'replace');
}
