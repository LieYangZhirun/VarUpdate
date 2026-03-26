/**
 * modules/format-parser.ts
 *
 * 模块 1：多格式解析器
 *
 * 接收一段结构化文本，自动检测格式（JSON → TOML → YAML），解析为 JavaScript 对象。
 *
 * 依赖：
 * - YAML：优先使用 iframe 全局 YAML；否则使用打包的 js-yaml（酒馆助手 iframe 常无全局 YAML）
 * - smol-toml（CDN import）
 */

import { load as yamlLoad } from 'js-yaml';

// ═══════════════════════════════════════════
//  错误类
// ═══════════════════════════════════════════

export class FormatParseError extends Error {
  constructor(
    message: string,
    public readonly details: {
      jsonError?: string;
      tomlError?: string;
      yamlError?: string;
    }
  ) {
    super(message);
    this.name = 'FormatParseError';
  }
}

/** 将解析失败信息展开为可读多行文本（用于 toastr / 日志） */
export function formatFormatParseDetails(e: FormatParseError): string {
  const d = e.details;
  const lines = [e.message];
  if (d.jsonError) lines.push(`JSON：${d.jsonError}`);
  if (d.tomlError) lines.push(`TOML：${d.tomlError}`);
  if (d.yamlError) lines.push(`YAML：${d.yamlError}`);
  return lines.join('\n');
}

// ═══════════════════════════════════════════
//  TOML 解析器（运行时 CDN 加载）
// ═══════════════════════════════════════════

let TOML: { parse: (text: string) => any } | null = null;

/**
 * 加载 smol-toml（仅首次调用时从 CDN 加载）
 */
async function ensureTOML(): Promise<typeof TOML> {
  if (!TOML) {
    try {
      const module = await import(
        // @ts-ignore - CDN URL import
        'https://testingcf.jsdelivr.net/npm/smol-toml/+esm'
      );
      TOML = module.default || module;
    } catch {
      // TOML 不可用时（如网络问题），跳过 TOML 尝试
      TOML = null;
    }
  }
  return TOML;
}

// ═══════════════════════════════════════════
//  主入口
// ═══════════════════════════════════════════

/**
 * 将文本解析为 JavaScript 对象
 *
 * 按以下顺序尝试：JSON → TOML → YAML，首个成功即返回。
 *
 * @param text 待解析的文本（YAML / JSON / TOML 格式）
 * @returns 解析后的对象
 * @throws {FormatParseError} 三种格式均无法解析时
 */
export async function parseStructuredText(text: string): Promise<Record<string, any>> {
  const errors: { jsonError?: string; tomlError?: string; yamlError?: string } = {};

  // 清理输入
  const cleaned = text.trim();
  if (!cleaned) {
    throw new FormatParseError('输入文本为空', errors);
  }

  // 1. 尝试 JSON
  try {
    const result = JSON.parse(cleaned);
    return wrapIfNotObject(result);
  } catch (e) {
    errors.jsonError = (e as Error).message;
  }

  // 2. 尝试 TOML
  try {
    const toml = await ensureTOML();
    if (toml) {
      const result = toml.parse(cleaned);
      return wrapIfNotObject(result);
    }
  } catch (e) {
    errors.tomlError = (e as Error).message;
  }

  // 3. 尝试 YAML（全局 YAML 对象）
  try {
    const result = parseYAML(cleaned);
    return wrapIfNotObject(result);
  } catch (e) {
    errors.yamlError = (e as Error).message;
  }

  throw new FormatParseError('无法解析文本：JSON / TOML / YAML 均失败', errors);
}

/**
 * 同步版本（仅 JSON + YAML，跳过 TOML）
 *
 * 用于不需要 TOML 支持或测试不方便 async 的场景。
 */
export function parseStructuredTextSync(text: string): Record<string, any> {
  const errors: { jsonError?: string; yamlError?: string } = {};
  const cleaned = text.trim();

  if (!cleaned) {
    throw new FormatParseError('输入文本为空', errors);
  }

  // 1. 尝试 JSON
  try {
    return wrapIfNotObject(JSON.parse(cleaned));
  } catch (e) {
    errors.jsonError = (e as Error).message;
  }

  // 2. 尝试 YAML
  try {
    return wrapIfNotObject(parseYAML(cleaned));
  } catch (e) {
    errors.yamlError = (e as Error).message;
  }

  throw new FormatParseError('无法解析文本：JSON / YAML 均失败', errors);
}

// ═══════════════════════════════════════════
//  工具函数
// ═══════════════════════════════════════════

/**
 * YAML 解析封装
 *
 * 优先使用宿主/iframe 提供的 `YAML.load`（须为函数）。
 * 若仅有名为 YAML 的占位对象而无 `.load`（酒馆助手环境常见），回退到打包的 js-yaml。
 */
function parseYAML(text: string): any {
  const g = typeof globalThis !== 'undefined' ? (globalThis as { YAML?: { load?: (s: string) => unknown } }).YAML : undefined;
  if (g && typeof g.load === 'function') {
    return g.load(text);
  }
  return yamlLoad(text);
}

/**
 * 如果解析结果不是对象，包裹为 { _value: result }
 */
function wrapIfNotObject(result: any): Record<string, any> {
  if (result === null || result === undefined) {
    return {};
  }
  if (typeof result !== 'object' || Array.isArray(result)) {
    return { _value: result };
  }
  return result;
}
