/**
 * modules/json-patch/index.ts
 *
 * 模块 3：JSON Patch 引擎 —— 主入口
 *
 * 编排三层管道：
 * 1. 指令预处理（公共库 flexible-json-patch）
 * 2. 反向路径解析
 * 3. 执行与校验
 */

import { resolvePath } from './path-resolver.js';
import { executeInstructions } from './executor.js';
import * as notify from '../notification.js';
import type { PatchInstruction, UpdateResult } from '../../types/index.js';
import { bindSafeParseWithContext } from '../schema-compiler/index.js';
import type { CompiledSchema, ValidationContext } from '../schema-compiler/index.js';

// ═══════════════════════════════════════════
//  CDN 模块加载
// ═══════════════════════════════════════════

let flexibleJsonPatch: {
  parseInstructions: (rawText: string) => { instructions: PatchInstruction[]; discarded: any[] };
} | null = null;

async function ensureFlexibleJsonPatch() {
  if (!flexibleJsonPatch) {
    try {
      flexibleJsonPatch = await import(
        // @ts-ignore
        'https://testingcf.jsdelivr.net/gh/LieYangZhirun/Flexible-json-patch/dist/index.js'
      );
    } catch (e) {
      throw new Error(`加载 flexible-json-patch 失败: ${(e as Error).message}`);
    }
  }
  return flexibleJsonPatch!;
}

// ═══════════════════════════════════════════
//  公开接口
// ═══════════════════════════════════════════

/**
 * 解析并执行一组更新指令（接口与契约 模块3）
 *
 * 三层管道：预处理 → 路径解析 → 执行校验
 *
 * @param rawText <Var_Update> 标签内的原始文本
 * @param currentData 当前变量状态的深拷贝
 * @param schema 已编译的 Schema（可选，用于逐条校验）
 * @param context 校验上下文（可选，供 refer()；内部会绑定为 safeParseWithContext）
 * @returns 执行结果
 */
export async function executeUpdate(
  rawText: string,
  currentData: Record<string, any>,
  schema?: CompiledSchema,
  context?: ValidationContext
): Promise<UpdateResult> {

  // ═══ 第一层：指令预处理 ═══
  const lib = await ensureFlexibleJsonPatch();
  let parseResult;
  try {
    parseResult = lib.parseInstructions(rawText);
  } catch (e) {
    // F-2: 整段解析失败 → 抛出异常，由 handleUpdate 广播 UPDATE_FAILED
    notify.error('指令解析失败', (e as Error).message);
    throw e;
  }

  // 记录预处理丢弃的条目
  if (parseResult.discarded.length > 0) {
    notify.warning(
      '指令预处理',
      `${parseResult.discarded.length} 条指令格式不合法被丢弃`
    );
  }

  if (parseResult.instructions.length === 0) {
    notify.warning('指令为空', '预处理后无有效指令');
    return {
      data: currentData,
      appliedCount: 0,
      discarded: [],
      log: {},
    };
  }

  // ═══ 第二层：反向路径解析 ═══
  const resolvedInstructions: PatchInstruction[] = [];
  const pathDiscarded: Array<{ instruction: PatchInstruction; reason: string }> = [];

  for (const instruction of parseResult.instructions) {
    const result = resolvePath(instruction.path, currentData, instruction.op);

    if ('reason' in result) {
      pathDiscarded.push({ instruction, reason: result.reason });
      notify.debug('路径解析失败', `${instruction.path}: ${result.reason}`);
    } else {
      if (result.corrected) {
        notify.debug('路径修正', `${result.original} → ${result.resolved}`);
      }
      resolvedInstructions.push({
        ...instruction,
        path: result.resolved,
      });
    }
  }

  if (resolvedInstructions.length === 0) {
    return {
      data: currentData,
      appliedCount: 0,
      discarded: pathDiscarded,
      log: {},
    };
  }

  // ═══ 第三层：执行与校验（带 refer 时需 bindSafeParseWithContext） ═══
  let safeParseBound: ((d: Record<string, any>) => { success: boolean; data?: any; error?: any }) | undefined;
  if (schema) {
    safeParseBound = await bindSafeParseWithContext(schema, context);
  }

  const execResult = executeInstructions(
    resolvedInstructions,
    currentData,
    schema,
    safeParseBound,
  );

  // 合并丢弃记录
  execResult.discarded = [...pathDiscarded, ...execResult.discarded];

  // 通知结果
  if (execResult.appliedCount > 0) {
    notify.success(
      '变量更新完成',
      `${execResult.appliedCount} 条指令执行成功` +
      (execResult.discarded.length > 0 ? `，${execResult.discarded.length} 条被丢弃` : '')
    );
  }

  return execResult;
}

/**
 * 同步版本：直接接受已解析的指令数组（跳过第一层）
 *
 * 用于测试或已经预处理完的场景。若需 refer()，请传入已由 bindSafeParseWithContext 得到的解析函数。
 */
export function executeUpdateSync(
  instructions: PatchInstruction[],
  currentData: Record<string, any>,
  schema?: CompiledSchema,
  safeParseWithContext?: (data: Record<string, any>) => { success: boolean; data?: any; error?: any },
): UpdateResult {
  const resolvedInstructions: PatchInstruction[] = [];
  const pathDiscarded: Array<{ instruction: PatchInstruction; reason: string }> = [];

  for (const instruction of instructions) {
    const result = resolvePath(instruction.path, currentData, instruction.op);
    if ('reason' in result) {
      pathDiscarded.push({ instruction, reason: result.reason });
    } else {
      resolvedInstructions.push({ ...instruction, path: result.resolved });
    }
  }

  const execResult = executeInstructions(resolvedInstructions, currentData, schema, safeParseWithContext);
  execResult.discarded = [...pathDiscarded, ...execResult.discarded];
  return execResult;
}
