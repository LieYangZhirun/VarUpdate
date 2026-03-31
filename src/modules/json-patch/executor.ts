/**
 * modules/json-patch/executor.ts
 *
 * JSON Patch 指令执行器
 *
 * 逐条执行指令，每条执行后用 Schema 校验，失败则单条回滚。
 * 生成变更日志（旧值 → 新值）。
 */

import { safeParseWithContext } from '../schema-compiler/schema-to-zod.js';
import { getValueByPath, setValueByPath, deleteByPath, parsePath } from '../../shared/path-utils.js';
import { fillPatchValueForSchemaPath } from './patch-value-fill.js';
import type { PatchInstruction, UpdateResult } from '../../types/index.js';
import type { CompiledSchema } from '../schema-compiler/index.js';
import * as notify from '../notification.js';
import { deepClone } from '../variable-store.js';

// ═══════════════════════════════════════════
//  公开接口
// ═══════════════════════════════════════════

/**
 * 执行一组已解析和路径已确定的 Patch 指令
 *
 * @param instructions 指令数组（路径已通过反向解析确定）
 * @param currentData 当前变量状态的深拷贝
 * @param schema 已编译的 Schema（可选，用于逐条校验）
 * @param boundSafeParse 由 bindSafeParseWithContext 提供时可启用 refer()；缺省则用 safeParseWithContext(schema, data, null)
 * @returns 执行结果
 */
export function executeInstructions(
  instructions: PatchInstruction[],
  currentData: Record<string, any>,
  schema?: CompiledSchema,
  boundSafeParse?: (data: Record<string, any>) => { success: boolean; data?: any; error?: any },
): UpdateResult {
  const result: UpdateResult = {
    data: currentData,
    appliedCount: 0,
    discarded: [],
    log: {},
  };

  // 同一路径多条指令 → 仅保留最后一条
  const deduped = deduplicateByPath(instructions);

  for (const instruction of deduped) {
    // 整棵 data 深拷贝快照，单条失败时回滚到此状态
    const snapshot = deepClone(result.data);

    try {
      const oldValue = getValueByPath(result.data, instruction.path);

      // 执行操作
      const success = applyInstruction(instruction, result.data, schema);
      if (!success) {
        result.discarded.push({ instruction, reason: '操作执行失败' });
        continue;
      }

      if (schema?.validator) {
        // 无 bind 上下文时仍走 safeParseWithContext(..., null)，refer() 在 _ctx 为空时跳过，避免裸 safeParse 与 schema-to-zod 约定不一致
        const parseResult = boundSafeParse
          ? boundSafeParse(result.data)
          : safeParseWithContext(schema, result.data, null);
        if (!parseResult.success) {
          result.data = snapshot;
          const errorMsg = parseResult.error?.issues
            ?.map((e: any) => `${e.path?.join('/') ?? ''}: ${e.message}`)
            .join('; ') ?? '校验失败';
          result.discarded.push({ instruction, reason: `Schema 校验失败: ${errorMsg}` });
          continue;
        }
        // 使用 Zod 转换后的数据（force 类型自动转换等）
        if (parseResult.data) {
          result.data = parseResult.data;
        }
      }

      // 记录变更日志
      const newValue = getValueByPath(result.data, instruction.path);
      result.log[instruction.path] = formatChangeLog(instruction.op, oldValue, newValue);
      result.appliedCount++;

    } catch (e) {
      // 异常 → 回滚
      result.data = snapshot;
      result.discarded.push({ instruction, reason: `执行异常: ${(e as Error).message}` });
    }
  }

  return result;
}

// ═══════════════════════════════════════════
//  指令执行
// ═══════════════════════════════════════════

/**
 * 执行单条 Patch 指令
 *
 * @returns 是否执行成功
 */
function applyInstruction(
  instruction: PatchInstruction,
  data: Record<string, any>,
  schema?: CompiledSchema,
): boolean {
  const { op, path, value } = instruction;

  const valueForWrite =
    schema?.raw && value !== undefined && (op === 'replace' || op === 'insert')
      ? fillPatchValueForSchemaPath(schema.raw, path, value)
      : value;

  switch (op) {
    case 'replace': {
      // 检查路径存在
      const existing = getValueByPath(data, path);
      if (existing === undefined) {
        return false; // 路径不存在，replace 失败
      }
      setValueByPath(data, path, valueForWrite);
      return true;
    }

    case 'insert': {
      const segments = parsePath(path);
      const lastSeg = segments[segments.length - 1];

      if (lastSeg === '-') {
        const parentPath = segments.slice(0, -1).join('/');
        const parent = getValueByPath(data, parentPath);
        if (!Array.isArray(parent)) {
          return false;
        }
        setValueByPath(data, path, valueForWrite);
        return true;
      }

      // 检查路径是否已存在（insert 不覆盖已有值）
      const existing = getValueByPath(data, path);
      if (existing !== undefined) {
        return false; // 已存在，insert 失败
      }
      setValueByPath(data, path, valueForWrite);
      return true;
    }

    case 'delete': {
      return deleteByPath(data, path);
    }

    default:
      return false;
  }
}

// ═══════════════════════════════════════════
//  工具函数
// ═══════════════════════════════════════════

/**
 * 同一路径多条指令时仅保留最后一条（面向用户功能卡 · D-3）。
 *
 * 被合并丢弃的同路径指令合并为一条 warning。
 */
function deduplicateByPath(instructions: PatchInstruction[]): PatchInstruction[] {
  const pathMap = new Map<string, { inst: PatchInstruction; count: number }>();

  for (const inst of instructions) {
    const existing = pathMap.get(inst.path);
    if (existing) {
      existing.inst = inst;
      existing.count++;
    } else {
      pathMap.set(inst.path, { inst, count: 1 });
    }
  }

  const duplicated = Array.from(pathMap.entries())
    .filter(([_, v]) => v.count > 1)
    .map(([path, v]) => `${path} (${v.count}条→保留最后1条)`);

  if (duplicated.length > 0) {
    notify.warning('同路径指令去重', duplicated.join(', '), { category: 'pat' });
  }

  return Array.from(pathMap.values()).map(v => v.inst);
}

/**
 * 格式化变更日志
 */
function formatChangeLog(op: string, oldValue: any, newValue: any): string {
  const formatVal = (v: any) => {
    if (v === undefined) return '(未定义)';
    if (v === null) return 'null';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  switch (op) {
    case 'replace':
      return `${formatVal(oldValue)} → ${formatVal(newValue)}`;
    case 'insert':
      return `(新增) → ${formatVal(newValue)}`;
    case 'delete':
      return `${formatVal(oldValue)} → (删除)`;
    default:
      return `${formatVal(oldValue)} → ${formatVal(newValue)}`;
  }
}
