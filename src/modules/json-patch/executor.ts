/**
 * modules/json-patch/executor.ts
 *
 * JSON Patch 指令执行器
 *
 * 逐条执行指令，每条执行后用 Schema 校验，失败则单条回滚。
 * 生成变更日志（旧值 → 新值）。
 */

import { getValueByPath, setValueByPath, deleteByPath, parsePath } from '../../shared/path-utils.js';
import type { PatchInstruction, UpdateResult } from '../../types/index.js';
import type { CompiledSchema, ValidationContext, ValidationResult } from '../schema-compiler/index.js';

// ═══════════════════════════════════════════
//  公开接口
// ═══════════════════════════════════════════

/**
 * 执行一组已解析和路径已确定的 Patch 指令
 *
 * @param instructions 指令数组（路径已通过反向解析确定）
 * @param currentData 当前变量状态的深拷贝
 * @param schema 已编译的 Schema（可选，用于逐条校验）
 * @param validateFn 校验函数（可选）
 * @param context 校验上下文（可选，供 refer() 使用）
 * @returns 执行结果
 */
export function executeInstructions(
  instructions: PatchInstruction[],
  currentData: Record<string, any>,
  schema?: CompiledSchema,
  validateFn?: (schema: CompiledSchema, data: Record<string, any>, ctx: ValidationContext) => ValidationResult,
  context?: ValidationContext
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
    // 保存快照（浅拷贝关键路径）
    const snapshot = JSON.parse(JSON.stringify(result.data));

    try {
      const oldValue = getValueByPath(result.data, instruction.path);

      // 执行操作
      const success = applyInstruction(instruction, result.data);
      if (!success) {
        result.discarded.push({ instruction, reason: '操作执行失败' });
        continue;
      }

      // Schema 校验（如果提供了 Schema）
      if (schema && validateFn && context) {
        const validationResult = validateFn(schema, result.data, context);
        if (!validationResult.success) {
          // 校验失败 → 回滚
          result.data = snapshot;
          const errorMsg = validationResult.errors.map(e => `${e.path}: ${e.message}`).join('; ');
          result.discarded.push({ instruction, reason: `Schema 校验失败: ${errorMsg}` });
          continue;
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
function applyInstruction(instruction: PatchInstruction, data: Record<string, any>): boolean {
  const { op, path, value } = instruction;

  switch (op) {
    case 'replace': {
      // 检查路径存在
      const existing = getValueByPath(data, path);
      if (existing === undefined) {
        return false; // 路径不存在，replace 失败
      }
      setValueByPath(data, path, value);
      return true;
    }

    case 'insert': {
      const segments = parsePath(path);
      const lastSeg = segments[segments.length - 1];

      if (lastSeg === '-') {
        // 数组末尾追加
        setValueByPath(data, path, value);
        return true;
      }

      // 检查路径是否已存在（insert 不覆盖已有值）
      const existing = getValueByPath(data, path);
      if (existing !== undefined) {
        return false; // 已存在，insert 失败
      }
      setValueByPath(data, path, value);
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
 * 同一路径多条指令 → 仅保留最后一条
 */
function deduplicateByPath(instructions: PatchInstruction[]): PatchInstruction[] {
  const pathMap = new Map<string, PatchInstruction>();

  for (const inst of instructions) {
    pathMap.set(inst.path, inst);
  }

  return Array.from(pathMap.values());
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
