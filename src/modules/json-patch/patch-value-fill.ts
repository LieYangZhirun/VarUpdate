/**
 * Patch 写入值补全：
 * AI 输出的 object 可能缺少 Schema 中声明的子键，
 * 此模块按操作类型（insert / replace）和字段可选性补全缺失值。
 *
 * 核心逻辑委托给 `shared/schema-defaults.ts` 中的 `fillDefaultsForValue`。
 */

import { parsePath } from '../../shared/path-utils.js';
import { fillDefaultsForValue, getDefaultValue, isFieldOptional } from '../../shared/schema-defaults.js';
import type { FillDefaultsOptions } from '../../shared/schema-defaults.js';
import { deepClone } from '../variable-store.js';

const ARRAY_TYPE_RE = /^array<(.+)>$/i;
const RECORD_TYPE_RE = /^record<(.+)>$/i;

const BUILTIN_TYPES = new Set(['number', 'integer', 'string', 'boolean', 'any', 'object',
  'number(force)', 'integer(force)', 'string(force)']);

/** 判断类型名是否为内置基础类型或 array<T>/record<T> 容器类型 */
function isBuiltinOrContainerType(name: string): boolean {
  return BUILTIN_TYPES.has(name.toLowerCase()) ||
    ARRAY_TYPE_RE.test(name) ||
    RECORD_TYPE_RE.test(name);
}

function resolveTypeNameToSchemaNode(raw: Record<string, any>, typeName: string): any {
  const name = typeName.trim();
  const lower = name.toLowerCase();
  if (
    ['number', 'integer', 'string', 'boolean', 'any', 'object'].includes(lower) ||
    name.includes('(')
  ) {
    return { $type: name };
  }
  return raw.$defs?.[name] ?? { $type: name };
}

/**
 * 解析变量路径在 Schema 原文中对应的「值类型」节点（叶子路径 = 该处写入值的约束节点）。
 */
export function getSchemaNodeForPath(raw: Record<string, any>, path: string): any | null {
  const segs = parsePath(path);
  if (segs.length === 0) return null;

  let cur: any = raw;

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (cur == null || typeof cur !== 'object') return null;

    if (i === 0) {
      if (s === '$defs' || !Object.prototype.hasOwnProperty.call(cur, s)) return null;
      cur = cur[s];
      continue;
    }

    if (/^\d+$/.test(s)) {
      const t = cur.$type;
      if (typeof t !== 'string') return null;
      const m = t.trim().match(ARRAY_TYPE_RE);
      if (!m) return null;
      cur = resolveTypeNameToSchemaNode(raw, m[1]);
      continue;
    }

    const t = cur.$type;
    if (typeof t === 'string' && RECORD_TYPE_RE.test(t.trim())) {
      const inner = t.trim().match(RECORD_TYPE_RE)![1];
      cur = resolveTypeNameToSchemaNode(raw, inner);
      continue;
    }

    // $defs 引用解析：$type 为非内置/非容器类型名 → 从 $defs 解引用后查找子键
    if (typeof t === 'string' && !isBuiltinOrContainerType(t.trim())) {
      const resolved = resolveTypeNameToSchemaNode(raw, t.trim());
      if (resolved && typeof resolved === 'object' && resolved !== cur) {
        if (Object.prototype.hasOwnProperty.call(resolved, s) && !s.startsWith('$')) {
          cur = resolved[s];
          continue;
        }
      }
    }

    // union 类型：遍历各分支，在任一分支中找到目标键即可
    if (Array.isArray(t)) {
      let found = false;
      for (const br of t) {
        if (typeof br !== 'string') continue;
        const brNode = resolveTypeNameToSchemaNode(raw, br.trim());
        if (brNode && typeof brNode === 'object') {
          if (Object.prototype.hasOwnProperty.call(brNode, s) && !s.startsWith('$')) {
            cur = brNode[s];
            found = true;
            break;
          }
        }
      }
      if (found) continue;
    }

    if (Object.prototype.hasOwnProperty.call(cur, s) && !s.startsWith('$')) {
      cur = cur[s];
      continue;
    }

    return null;
  }

  return cur;
}

/**
 * 按路径对应的 Schema 为 Patch 写入值补全缺失子键。
 *
 * @param rawSchema Schema 原文
 * @param path 操作路径
 * @param value 写入值
 * @param op 操作类型（insert 或 replace）
 * @param oldValue replace 模式时对应路径的旧值（用于保留旧字段）
 * @returns 补全后的值
 */
export function fillPatchValueForSchemaPath(
  rawSchema: Record<string, any>,
  path: string,
  value: unknown,
  op: 'insert' | 'replace' = 'insert',
  oldValue?: unknown,
): unknown {
  if (value === undefined) return value;
  const schemaLeaf = getSchemaNodeForPath(rawSchema, path);
  if (schemaLeaf === null) return value;

  const cloned = deepClone(value);
  if (cloned === null || typeof cloned !== 'object' || Array.isArray(cloned)) {
    return cloned;
  }

  return fillDefaultsForValue(cloned, schemaLeaf, rawSchema, {
    mode: op,
    oldValue: op === 'replace' ? oldValue : undefined,
  });
}

export { getDefaultValue, isFieldOptional };
