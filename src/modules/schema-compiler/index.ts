/**
 * modules/schema-compiler/index.ts
 *
 * 模块 2：Schema 编译器
 *
 * 对 schema-to-zod 的封装层（与主包一并打包），添加 VarUpdate 特有功能：
 * - 与模块 1（格式解析器）集成
 * - Schema 缓存（避免重复编译）
 * - 与通知系统集成（编译错误 → L3 通知）
 */

import {
  compileSchema,
  validateWithSchema,
  safeParseWithContext,
} from '@vendor/schema-to-zod';
import type {
  CompiledSchema,
  ValidationContext,
  ValidationResult,
} from '@vendor/schema-to-zod';
import { parseStructuredText, FormatParseError } from '../format-parser.js';
import * as notify from '../notification.js';

export type { CompiledSchema, ValidationContext, ValidationResult };

// ═══════════════════════════════════════════
//  Schema 缓存
// ═══════════════════════════════════════════

let cachedSchema: CompiledSchema | null = null;
let cachedSchemaHash: string | null = null;

/**
 * 计算简单的对象哈希（用于缓存判断）
 */
function computeHash(data: Record<string, any>): string {
  return JSON.stringify(data);
}

// ═══════════════════════════════════════════
//  公开接口
// ═══════════════════════════════════════════

/**
 * 从文本编译 Schema
 *
 * 1. 使用格式解析器将文本解析为 JSON 对象
 * 2. 调用 schema-to-zod 编译为 Zod 校验对象
 * 3. 缓存结果（相同 Schema 不重复编译）
 *
 * @param schemaText Schema 文本（YAML/JSON/TOML 格式）
 * @returns 编译后的 Schema 对象
 */
export async function compileSchemaFromText(schemaText: string): Promise<CompiledSchema> {
  // 步骤 1：解析文本
  let schemaData: Record<string, any>;
  try {
    schemaData = await parseStructuredText(schemaText);
  } catch (e) {
    if (e instanceof FormatParseError) {
      notify.error('Schema 解析失败', e.message);
    }
    throw e;
  }

  // 步骤 2：检查缓存
  const hash = computeHash(schemaData);
  if (cachedSchema && cachedSchemaHash === hash) {
    notify.debug('Schema 缓存命中', '使用已编译的 Schema');
    return cachedSchema;
  }

  // 步骤 3：编译
  try {
    const compiled = compileSchema(schemaData);
    cachedSchema = compiled;
    cachedSchemaHash = hash;
    notify.success('Schema 编译成功', `定义了 ${compiled.defNames.length} 个结构体`);
    return compiled;
  } catch (e) {
    notify.error('Schema 编译失败', (e as Error).message);
    throw e;
  }
}

/**
 * 从已解析的 JSON 对象编译 Schema（跳过文本解析步骤）
 */
export async function compileSchemaFromData(schemaData: Record<string, any>): Promise<CompiledSchema> {
  const hash = computeHash(schemaData);
  if (cachedSchema && cachedSchemaHash === hash) {
    return cachedSchema;
  }

  try {
    const compiled = compileSchema(schemaData);
    cachedSchema = compiled;
    cachedSchemaHash = hash;
    return compiled;
  } catch (e) {
    notify.error('Schema 编译失败', (e as Error).message);
    throw e;
  }
}

/**
 * 使用已编译的 Schema 校验数据
 */
export async function validate(
  schema: CompiledSchema,
  data: Record<string, any>,
  context: ValidationContext,
): Promise<ValidationResult> {
  return validateWithSchema(schema, data, context);
}

/**
 * 清除 Schema 缓存（切换聊天时调用）
 */
export function clearCache(): void {
  cachedSchema = null;
  cachedSchemaHash = null;
}

/**
 * 获取当前缓存的 Schema（可能为 null）
 */
export function getCachedSchema(): CompiledSchema | null {
  return cachedSchema;
}

/**
 * 绑定带 ValidationContext 的 safeParse，供 JSON Patch 逐条校验时启用 refer()。
 * 闭包内使用传入的 schema；data 每次由调用方传入当前快照（须与 Patch 正在变异的对象为同一引用链上的读视图）。
 */
export async function bindSafeParseWithContext(
  schema: CompiledSchema,
  context: ValidationContext | undefined,
): Promise<(data: Record<string, any>) => { success: boolean; data?: any; error?: any }> {
  const ctx = context ?? null;
  return (data: Record<string, any>) => safeParseWithContext(schema, data, ctx);
}
