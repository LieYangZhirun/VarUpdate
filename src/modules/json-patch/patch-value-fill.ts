/**
 * Patch 写入值补全：AI 输出的 object 若缺少未标记 $optional 的子键，用 $default 或 null 填充，
 * 避免整段 Schema 校验失败（与 Initial 阶段 mergeDefaults 不同，仅作用于单条 Patch 的 value）。
 */

import { parsePath } from '../../shared/path-utils.js';
import { deepClone } from '../variable-store.js';

const ARRAY_TYPE_RE = /^array<(.+)>$/i;
const RECORD_TYPE_RE = /^record<(.+)>$/i;

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

    if (Object.prototype.hasOwnProperty.call(cur, s) && !s.startsWith('$')) {
      cur = cur[s];
      continue;
    }

    return null;
  }

  return cur;
}

function collectObjectFieldKeys(schemaObj: Record<string, any>): string[] {
  return Object.keys(schemaObj).filter(k => !k.startsWith('$'));
}

/**
 * 将 Schema 节点解析为可枚举字段的 object 形状（解析 $defs 引用与 $type: object）。
 */
function unwrapToObjectSchemaNode(node: any, raw: Record<string, any>): Record<string, any> | null {
  if (!node || typeof node !== 'object') return null;

  let n = node;
  for (let depth = 0; depth < 24; depth++) {
    const t = n.$type;

    if (t === undefined) {
      const keys = collectObjectFieldKeys(n);
      return keys.length > 0 ? n : null;
    }

    if (typeof t === 'string') {
      const ts = t.trim();
      if (ts.toLowerCase() === 'object') {
        return n;
      }
      if (ARRAY_TYPE_RE.test(ts) || RECORD_TYPE_RE.test(ts)) {
        return null;
      }
      if (Array.isArray(t)) {
        for (const br of t) {
          if (typeof br !== 'string') continue;
          const def = raw.$defs?.[br.trim()];
          if (def) {
            const inner = unwrapToObjectSchemaNode(def, raw);
            if (inner) return inner;
          }
        }
        return null;
      }
      const def = raw.$defs?.[ts];
      if (def) {
        n = def;
        continue;
      }
      return null;
    }

    return null;
  }

  return null;
}

function fillObjectRecursive(value: any, schemaNode: any, raw: Record<string, any>): void {
  const shape = unwrapToObjectSchemaNode(schemaNode, raw);
  if (!shape) return;
  if (value === null || value === undefined) return;
  if (typeof value !== 'object' || Array.isArray(value)) return;

  for (const key of collectObjectFieldKeys(shape)) {
    const childDef = shape[key];
    if (typeof childDef !== 'object' || childDef === null) continue;

    const optional = childDef.$optional === true;
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      if (optional) continue;
      value[key] = Object.prototype.hasOwnProperty.call(childDef, '$default')
        ? childDef.$default
        : null;
    }

    const childVal = value[key];
    if (childVal !== null && typeof childVal === 'object' && !Array.isArray(childVal)) {
      fillObjectRecursive(childVal, childDef, raw);
    }
  }
}

/**
 * 按路径对应的 Schema 为 Patch 写入值补全缺失的 object 子键（就地逻辑在克隆上进行）。
 */
export function fillPatchValueForSchemaPath(
  rawSchema: Record<string, any>,
  path: string,
  value: unknown,
): unknown {
  if (value === undefined) return value;
  const schemaLeaf = getSchemaNodeForPath(rawSchema, path);
  if (schemaLeaf === null) return value;

  const cloned = deepClone(value);
  if (cloned === null || typeof cloned !== 'object' || Array.isArray(cloned)) {
    return cloned;
  }

  fillObjectRecursive(cloned, schemaLeaf, rawSchema);
  return cloned;
}
