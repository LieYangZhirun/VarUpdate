/**
 * 按 Schema 中 `$hide: true` 裁剪待注入数据（不修改入参对象）。
 * 供 `{{message/data/…}}` 等宏在序列化前省略作者指定隐藏的子树（规则见面向用户功能卡 · K-2）。
 */

import { getValueByPath, parsePath } from './path-utils.js';

const PRIMITIVE_TYPES = new Set([
  'number',
  'integer',
  'string',
  'boolean',
  'any',
  'object',
]);

function isPrimitiveTypeName(s: string): boolean {
  const t = s.trim().toLowerCase();
  if (PRIMITIVE_TYPES.has(t)) return true;
  if (t === 'number(force)' || t === 'integer(force)' || t === 'string(force)') return true;
  return false;
}

/** Schema 节点是否标记为整棵子树对宏隐藏 */
export function schemaNodeIsHidden(node: unknown): boolean {
  return typeof node === 'object' && node !== null && (node as Record<string, unknown>).$hide === true;
}

/**
 * 沿变量路径在 raw Schema 中取节点（与 data 路径一致，/ 分段）。
 */
export function getSchemaNodeAtPath(schemaRaw: Record<string, any>, pathParts: string[]): unknown {
  let cur: unknown = schemaRaw;
  for (const seg of pathParts) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    const o = cur as Record<string, unknown>;
    if (!(seg in o)) return undefined;
    cur = o[seg];
  }
  return cur;
}

function parseArrayInner($type: unknown): string | null {
  if (typeof $type !== 'string') return null;
  const m = $type.trim().match(/^array<(.+)>$/i);
  return m ? m[1].trim() : null;
}

function parseRecordInner($type: unknown): string | null {
  if (typeof $type !== 'string') return null;
  const m = $type.trim().match(/^record<(.+)>$/i);
  return m ? m[1].trim() : null;
}

/** 由 $type 字符串或 $defs 名得到「元素 / record 值」侧 Schema 节点 */
function resolveInnerTypeSchema(inner: string, schemaRaw: Record<string, any>): unknown {
  const name = inner.trim();
  if (isPrimitiveTypeName(name)) {
    return { $type: name };
  }
  return schemaRaw.$defs?.[name];
}

function getArrayElementSchema(schemaNode: Record<string, any>, schemaRaw: Record<string, any>): unknown {
  const inner = parseArrayInner(schemaNode.$type);
  if (!inner) return undefined;
  return resolveInnerTypeSchema(inner, schemaRaw);
}

function getRecordValueSchema(schemaNode: Record<string, any>, schemaRaw: Record<string, any>): unknown {
  const inner = parseRecordInner(schemaNode.$type);
  if (!inner) return undefined;
  return resolveInnerTypeSchema(inner, schemaRaw);
}

function getObjectChildSchema(schemaNode: Record<string, any>, key: string): unknown {
  if (!(key in schemaNode)) return undefined;
  if (key.startsWith('$')) return undefined;
  return schemaNode[key];
}

/**
 * 在已知 Schema 子树下裁剪 $hide；schemaNode 可为 undefined（表示无定义，原样透出）。
 */
export function filterValueBySchemaHide(
  schemaNode: unknown,
  value: unknown,
  schemaRaw: Record<string, any>,
): unknown {
  if (value === null || value === undefined) return value;

  if (schemaNodeIsHidden(schemaNode)) {
    return undefined;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (!schemaNode || typeof schemaNode !== 'object' || Array.isArray(schemaNode)) {
    return value;
  }

  const sn = schemaNode as Record<string, any>;

  if (Array.isArray(value)) {
    const elemSchema = getArrayElementSchema(sn, schemaRaw);
    if (!elemSchema) {
      return value;
    }
    return value.map(item => filterValueBySchemaHide(elemSchema, item, schemaRaw));
  }

  const recordInner = parseRecordInner(sn.$type);
  if (recordInner !== null) {
    const valSchema = resolveInnerTypeSchema(recordInner, schemaRaw);
    if (!valSchema) {
      return value;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (schemaNodeIsHidden(valSchema)) {
        continue;
      }
      const fv = filterValueBySchemaHide(valSchema, v, schemaRaw);
      if (fv !== undefined) {
        out[k] = fv;
      }
    }
    return out;
  }

  // object（显式或隐式）：子键在节点上
  if (sn.$type !== undefined && typeof sn.$type === 'string' && sn.$type.trim().toLowerCase() !== 'object') {
    // 标量带约束等，不应有 object value；原样返回
    if (!Array.isArray(value) && typeof value === 'object') {
      return value;
    }
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const childSn = getObjectChildSchema(sn, k);
    if (schemaNodeIsHidden(childSn)) {
      continue;
    }
    const fv = filterValueBySchemaHide(childSn, v, schemaRaw);
    if (fv !== undefined) {
      out[k] = fv;
    }
  }
  return out;
}

/** 宏替换侧：路径恰好落在 $hide 节点上时输出空白行，且不报「引用为空」 */
export interface MessageDataMacroFilterResult {
  value: unknown;
  /** true：路径终止于带 $hide 的 Schema 节点（概括该 object 时）；子路径更深则 false */
  terminalHidden: boolean;
}

/**
 * 对 message.data 在某路径下的取值做 $hide 裁剪（路径为空表示整棵 data）。
 *
 * **$hide 语义**：仅当宏路径**终止**在 `$hide` 节点上时标记 `terminalHidden`（替换为 `\n`）。
 * 路径继续深入到该节点**之下**的子键时，按**终端** Schema 节点判断，不因祖先 `$hide` 而屏蔽。
 */
export function filterMessageDataForMacro(
  dataRoot: Record<string, any>,
  schemaRaw: Record<string, any>,
  pathDotOrSlash: string,
): MessageDataMacroFilterResult {
  const normPath = pathDotOrSlash.replace(/\\/g, '/');
  const parts = parsePath(normPath);

  if (parts.length === 0) {
    const syntheticRoot: Record<string, unknown> = {};
    for (const key of Object.keys(dataRoot)) {
      if (key.startsWith('$')) continue;
      const childSn = schemaRaw[key];
      if (schemaNodeIsHidden(childSn)) {
        continue;
      }
      const fv = filterValueBySchemaHide(childSn, dataRoot[key], schemaRaw);
      if (fv !== undefined) {
        syntheticRoot[key] = fv;
      }
    }
    return { value: syntheticRoot, terminalHidden: false };
  }

  const schemaNode = getSchemaNodeAtPath(schemaRaw, parts);
  const sub = getValueByPath(dataRoot, normPath);

  if (schemaNodeIsHidden(schemaNode)) {
    return { value: undefined, terminalHidden: true };
  }

  return {
    value: filterValueBySchemaHide(schemaNode, sub, schemaRaw),
    terminalHidden: false,
  };
}
