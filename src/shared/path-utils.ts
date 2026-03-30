/**
 * shared/path-utils.ts
 *
 * 变量路径解析与读写（JSON Patch、变量存储、插值宏共用）。
 * 路径为 `/` 分隔的段序列，例如 `角色/HP`、`背包/0/名称`。
 */

import { hasWildcard, wildcardMatch } from './wildcard.js';

/**
 * 将 / 分隔的路径字符串转为段数组
 *
 * "角色/HP"       → ["角色", "HP"]
 * "背包/0/名称"   → ["背包", "0", "名称"]
 * ""              → []
 * "单独"          → ["单独"]
 */
export function parsePath(path: string): string[] {
  if (!path || path.trim() === '') return [];
  // 去除首尾 /
  const cleaned = path.replace(/^\/+|\/+$/g, '');
  if (cleaned === '') return [];
  return cleaned.split('/');
}

/**
 * 按路径从对象中取值
 *
 * @param data 数据对象
 * @param path / 分隔的路径字符串
 * @returns 路径对应的值，不存在时返回 undefined
 */
export function getValueByPath(data: any, path: string): any {
  const segments = parsePath(path);
  if (segments.length === 0) return data;

  let current = data;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;

    // 数字索引 → 尝试数组访问
    if (Array.isArray(current) && /^\d+$/.test(seg)) {
      current = current[parseInt(seg, 10)];
    } else {
      current = current[seg];
    }
  }
  return current;
}

/**
 * 按路径向对象中写值
 *
 * 中间路径不存在时自动创建（数字键名 → 数组，其他 → 对象）
 *
 * @param data 数据对象（会被就地修改）
 * @param path / 分隔的路径字符串
 * @param value 要写入的值
 */
export function setValueByPath(data: any, path: string, value: any): void {
  const segments = parsePath(path);
  if (segments.length === 0) return;

  let current = data;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const nextSeg = segments[i + 1];

    if (current[seg] === undefined || current[seg] === null || typeof current[seg] !== 'object') {
      // 自动创建中间节点
      current[seg] = /^\d+$/.test(nextSeg) ? [] : {};
    }

    if (Array.isArray(current) && /^\d+$/.test(seg)) {
      current = current[parseInt(seg, 10)];
    } else {
      current = current[seg];
    }
  }

  const lastSeg = segments[segments.length - 1];
  if (Array.isArray(current) && /^\d+$/.test(lastSeg)) {
    current[parseInt(lastSeg, 10)] = value;
  } else if (lastSeg === '-' && Array.isArray(current)) {
    // "-" → 数组末尾追加
    current.push(value);
  } else {
    current[lastSeg] = value;
  }
}

/**
 * 按路径删除对象中的值
 *
 * @param data 数据对象（会被就地修改）
 * @param path / 分隔的路径字符串
 * @returns 是否成功删除
 */
export function deleteByPath(data: any, path: string): boolean {
  const segments = parsePath(path);
  if (segments.length === 0) return false;

  let current = data;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (current === null || current === undefined || typeof current !== 'object') {
      return false;
    }
    if (Array.isArray(current) && /^\d+$/.test(seg)) {
      current = current[parseInt(seg, 10)];
    } else {
      current = current[seg];
    }
  }

  if (current === null || current === undefined || typeof current !== 'object') {
    return false;
  }

  const lastSeg = segments[segments.length - 1];
  if (Array.isArray(current) && /^\d+$/.test(lastSeg)) {
    const idx = parseInt(lastSeg, 10);
    if (idx >= 0 && idx < current.length) {
      current.splice(idx, 1);
      return true;
    }
    return false;
  } else if (lastSeg in current) {
    delete current[lastSeg];
    return true;
  }
  return false;
}

/**
 * 在对象中递归搜索所有叶子键名匹配的完整路径
 *
 * 用于反向路径解析的第一步（全局搜索候选集）
 *
 * @param data 数据对象
 * @param leafKey 要搜索的叶子键名
 * @param currentPath 当前路径前缀（递归用）
 * @returns 所有匹配的完整路径数组
 */
export function findAllPaths(data: any, leafKey: string, currentPath: string = ''): string[] {
  const results: string[] = [];

  if (data === null || data === undefined || typeof data !== 'object') {
    return results;
  }

  const entries = Array.isArray(data)
    ? data.map((v, i) => [String(i), v] as [string, any])
    : Object.entries(data);

  for (const [key, value] of entries) {
    const fullPath = currentPath ? `${currentPath}/${key}` : key;

    if (key === leafKey) {
      results.push(fullPath);
    }

    // 递归搜索子对象
    if (value !== null && typeof value === 'object') {
      results.push(...findAllPaths(value, leafKey, fullPath));
    }
  }

  return results;
}

/**
 * 反向模糊路径解析 (只读寻址)
 *
 * 类似 JSON Patch 的反向搜索逻辑，但仅用于已存在的读取：
 * 1. 拿叶子键全局搜索所有同名路径
 * 2. 用剩下的祖先节点从右向左进行消歧义过滤
 * 3. 只有剩下唯一结果时，才返回真实绝对路径
 */
export function resolveFuzzyPath(data: any, fuzzyPath: string): string | null {
  const segments = parsePath(fuzzyPath);
  if (segments.length === 0) return null;

  const leafKey = segments[segments.length - 1];

  // 特殊情况：如果是以数字或短横线结尾，大概率是严格数组操作，跳过模糊寻址
  if (leafKey === '-' || /^\d+$/.test(leafKey)) {
    return null;
  }

  // 1. 全局搜索匹配叶子的所有绝对路径
  const candidates = findAllPaths(data, leafKey);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // 2. 多项结果，从倒数第二层进行反向消歧义
  let filtered = [...candidates];
  for (let i = segments.length - 2; i >= 0 && filtered.length > 1; i--) {
    const ancestorKey = segments[i];
    if (/^\d+$/.test(ancestorKey)) continue; // 跳过数字段（数组索引不参与名字匹配）

    filtered = filtered.filter(candidatePath => {
      const candidateSegments = parsePath(candidatePath);
      return candidateSegments.includes(ancestorKey);
    });
  }

  // 3. 收敛为唯一明确结果
  if (filtered.length === 1) return filtered[0];

  // 仍有歧义，尝试精准完全匹配原始路径
  const exactMatch = filtered.find(c => c === fuzzyPath);
  if (exactMatch) return exactMatch;

  return null;
}

/**
 * 获取变量值：优先精准命中，失败则采用模糊反向寻址兜底
 * 适用于条件判定和插值宏等读取行为
 */
export function getFuzzyValueByPath(data: any, path: string): any {
  // 1. 尝试直接精准确切命中
  const exact = getValueByPath(data, path);
  if (exact !== undefined) return exact;

  // 2. 失败后进入模糊反向寻址补救
  const resolvedPath = resolveFuzzyPath(data, path);
  if (resolvedPath) {
    return getValueByPath(data, resolvedPath);
  }
  return undefined;
}

/**
 * 带有通配符的路径寻址
 * 
 * 如果路径中包含通配符，则进行树状分叉遍历，寻找所有合法分支，收集匹配到达终点的叶子节点值。
 * 如果路径中不包含通配符，则直接退化为调用 getFuzzyValueByPath。
 * 
 * @param data 根对象
 * @param path 带有通配符（如 `*`）的查找路径
 * @returns 是否触发了多分支匹配，以及搜集到的所有叶子节点值集合
 */
export function getValuesByWildcardPath(data: any, path: string): { isWildcard: boolean, values: any[] } {
  if (!hasWildcard(path)) {
    const val = getFuzzyValueByPath(data, path);
    return { isWildcard: false, values: val !== undefined ? [val] : [] };
  }

  const segments = parsePath(path);
  if (segments.length === 0) return { isWildcard: true, values: [] };

  const collected: any[] = [];
  
  function walk(current: any, segIndex: number) {
    if (current === null || current === undefined) return;
    
    // 如果已经跨过最后一段路径指示，把当前对象收集起来
    if (segIndex >= segments.length) {
      if (current !== undefined) collected.push(current);
      return;
    }
    
    // 如果还未走到底就已经遇到非对象（无法进一步潜入），则该分支探索失败
    if (typeof current !== 'object') return;

    const seg = segments[segIndex];
    if (hasWildcard(seg)) {
      // 该段含有通配符：遍历对象的全部合法键并进行 wildcardMatch 筛选
      const keys = Array.isArray(current) 
        ? current.map((_, i) => String(i)) 
        : Object.keys(current);
        
      for (const k of keys) {
        if (wildcardMatch(seg, k)) {
          walk((current as any)[k], segIndex + 1);
        }
      }
    } else {
      // 该段不含通配符：作为精准字面量匹配，仅对这单个分支继续探索
      if (Array.isArray(current) && /^\d+$/.test(seg)) {
        const idx = parseInt(seg, 10);
        if (idx >= 0 && idx < current.length) walk(current[idx], segIndex + 1);
      } else if (seg in current) {
        walk((current as any)[seg], segIndex + 1);
      }
    }
  }

  walk(data, 0);

  return { isWildcard: true, values: collected };
}

