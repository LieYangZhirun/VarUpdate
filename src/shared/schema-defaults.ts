/**
 * shared/schema-defaults.ts
 *
 * $default 默认值相关工具集：
 * - enrichSchemaWithDefaults：将 [Var_Default] 的值注入 Schema 的 $default 字段
 * - fillDefaultsForValue：按 insert / replace 上下文为变量值填充默认值
 * - getDefaultValue / isFieldOptional：辅助读取 Schema 节点属性
 */

const ARRAY_TYPE_RE = /^array<(.+)>$/i;
const RECORD_TYPE_RE = /^record<(.+)>$/i;

// ═══════════════════════════════════════════
//  辅助函数
// ═══════════════════════════════════════════

/** 获取 Schema 节点上的 $default 值；无 $default 时返回 undefined */
export function getDefaultValue(node: any): any {
  if (node && typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, '$default')) {
    return node.$default;
  }
  return undefined;
}

/** 判断 Schema 节点是否标记了 $optional: true */
export function isFieldOptional(node: any): boolean {
  return node && typeof node === 'object' && node.$optional === true;
}

/** 收集 Schema 对象节点中的非 $ 前缀字段名 */
function collectFieldKeys(obj: Record<string, any>): string[] {
  return Object.keys(obj).filter(k => !k.startsWith('$'));
}

/**
 * 将结构体类型名解析为 Schema 节点。
 * 基础类型返回 `{ $type: name }`；$defs 中存在的返回其定义。
 */
function resolveTypeToSchemaNode(raw: Record<string, any>, typeName: string): any {
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
 * 将 Schema 节点「展开」为可枚举字段的 object 形状。
 * 处理 $type: object、$defs 引用、隐式 object（有非 $ 子字段）。
 * 不进入 array / record。
 */
function unwrapToObjectShape(node: any, raw: Record<string, any>): Record<string, any> | null {
  if (!node || typeof node !== 'object') return null;

  let n = node;
  for (let depth = 0; depth < 24; depth++) {
    const t = n.$type;

    if (t === undefined) {
      const keys = collectFieldKeys(n);
      return keys.length > 0 ? n : null;
    }

    if (typeof t === 'string') {
      const ts = t.trim();
      if (ts.toLowerCase() === 'object') return n;
      if (ARRAY_TYPE_RE.test(ts) || RECORD_TYPE_RE.test(ts)) return null;

      // 别名引用：查找 $defs
      const def = raw.$defs?.[ts];
      if (def) { n = def; continue; }
      return null;
    }

    // union 类型（数组形式）：尝试展开第一个可 object 化的分支
    if (Array.isArray(t)) {
      for (const br of t) {
        if (typeof br !== 'string') continue;
        const def = raw.$defs?.[br.trim()];
        if (def) {
          const inner = unwrapToObjectShape(def, raw);
          if (inner) return inner;
        }
      }
      return null;
    }

    return null;
  }
  return null;
}

/**
 * 按顺序匹配 union 分支，返回第一个与值兼容的分支的 object shape。
 *
 * 兼容规则（与 Zod z.union() 行为一致——顺序尝试，先通过者胜出）：
 * - 非 extensible 分支：值中不能有该分支未声明的键 → 有则不兼容
 * - extensible 分支：允许多余键 → 不因此跳过
 *
 * @param branches union 类型的各分支（$type 数组中的元素）
 * @param raw 整份 Schema 原文
 * @param value 待填充的实际值（用于判断兼容性）
 * @returns 兼容分支的 object shape，无兼容分支时返回 null
 */
function resolveUnionBranch(
  branches: any[],
  raw: Record<string, any>,
  value: Record<string, any>,
): Record<string, any> | null {
  const valueKeys = Object.keys(value).filter(k => !k.startsWith('$'));

  for (const br of branches) {
    if (typeof br !== 'string') continue;

    // 解析分支为 Schema 节点（$defs 引用 → 实际定义）
    const brNode = resolveTypeToSchemaNode(raw, br.trim());
    if (!brNode || typeof brNode !== 'object') continue;

    // 展开为 object shape
    const shape = unwrapToObjectShape(brNode, raw);
    if (!shape) continue;

    const isExtensible = shape.$extensible === true;

    // 非 extensible 分支：值中不可有未声明键
    if (!isExtensible) {
      const declaredKeys = new Set(collectFieldKeys(shape));
      const hasUnknownKey = valueKeys.some(k => !declaredKeys.has(k));
      if (hasUnknownKey) continue; // 不兼容，尝试下一个分支
    }

    // 兼容 → 返回此分支的 shape
    return shape;
  }

  return null;
}

function cloneDeep<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  return JSON.parse(JSON.stringify(obj));
}

// ═══════════════════════════════════════════
//  enrichSchemaWithDefaults
// ═══════════════════════════════════════════

/**
 * 将 [Var_Default] 中的值注入 Schema 的 $default 字段。
 *
 * - **补全**：Schema 中已有 $default 的字段不被覆盖
 * - **仅主结构**：不进入 $defs 定义的结构体内部
 * - 返回新对象，不修改原 Schema
 *
 * 映射规则：
 * - Schema 节点为 object（含隐式 object）且 defaults 值也是 object：递归进入子字段
 * - Schema 节点为叶类型或容器类型（array/record）：将 defaults 值设为 $default
 */
export function enrichSchemaWithDefaults(
  schemaRaw: Record<string, any>,
  defaults: Record<string, any>,
): Record<string, any> {
  const result = cloneDeep(schemaRaw);
  enrichRecursive(result, defaults, result);
  return result;
}

function enrichRecursive(
  schemaNode: Record<string, any>,
  defaultNode: Record<string, any>,
  schemaRaw: Record<string, any>,
): void {
  for (const [key, defValue] of Object.entries(defaultNode)) {
    if (key.startsWith('$') || key === '$defs') continue;
    if (!(key in schemaNode)) continue;

    const child = schemaNode[key];
    if (child === null || typeof child !== 'object') continue;

    // 判断 Schema 子节点是否为 object 形状（含隐式 object）
    const childFieldKeys = collectFieldKeys(child);
    const typeStr = typeof child.$type === 'string' ? child.$type.trim().toLowerCase() : null;
    const isObjectNode =
      childFieldKeys.length > 0 ||
      typeStr === 'object';

    if (
      isObjectNode &&
      typeof defValue === 'object' && defValue !== null && !Array.isArray(defValue)
    ) {
      // Schema 子节点为 object，defaults 值也为 object：递归进入子字段
      enrichRecursive(child, defValue, schemaRaw);
    } else {
      // 叶类型 / 容器类型（array/record）：补全 $default
      if (!Object.prototype.hasOwnProperty.call(child, '$default')) {
        child.$default = cloneDeep(defValue);
      }
    }
  }
}

// ═══════════════════════════════════════════
//  fillDefaultsForValue
// ═══════════════════════════════════════════

export interface FillDefaultsOptions {
  /** 操作模式：insert（Initial/insert 指令）或 replace */
  mode: 'insert' | 'replace';
  /** replace 模式时的旧值（用于保留旧字段） */
  oldValue?: any;
}

/**
 * 按 Schema 定义为变量值填充缺失字段的 $default 值。
 *
 * **insert 模式**（Initial 和 insert 指令）：
 * - 所有有 $default 的缺失字段均填充，**包括 $optional 字段**
 * - 无 $default 且非可选的字段填 null（交给 Zod 校验捕获）
 *
 * **replace 模式**：
 * - 先从旧值中恢复缺失字段（保留旧值）
 * - 无旧值且非可选：用 $default 填充（无 $default 填 null）
 * - 无旧值且可选：不填
 *
 * 支持递归进入 object 子字段、array 元素、record 值。
 *
 * @param value 待填充的值（深拷贝后操作，不修改原值）
 * @param schemaNode 对应的 Schema 节点
 * @param schemaRaw 整份 Schema 原文（用于解析 $defs 引用）
 * @param opts 操作选项
 * @returns 填充后的新值
 */
export function fillDefaultsForValue(
  value: any,
  schemaNode: any,
  schemaRaw: Record<string, any>,
  opts: FillDefaultsOptions,
): any {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  // union 类型：先确定分支再填充（与 Zod z.union() 顺序匹配一致）
  let shape: Record<string, any> | null;
  if (schemaNode?.$type && Array.isArray(schemaNode.$type)) {
    shape = resolveUnionBranch(schemaNode.$type, schemaRaw, value);
  } else {
    shape = unwrapToObjectShape(schemaNode, schemaRaw);
  }
  if (!shape) return value;

  const result = cloneDeep(value);
  const oldObj =
    opts.mode === 'replace' &&
    opts.oldValue !== null &&
    opts.oldValue !== undefined &&
    typeof opts.oldValue === 'object' &&
    !Array.isArray(opts.oldValue)
      ? opts.oldValue
      : null;

  // 父节点 $default：object 类型的 $default 可以为子字段提供默认值
  const parentDefault = getDefaultValue(schemaNode);
  const parentDefObj = (
    parentDefault && typeof parentDefault === 'object' && !Array.isArray(parentDefault)
  ) ? parentDefault : null;

  for (const key of collectFieldKeys(shape)) {
    const childSchema = shape[key];
    if (typeof childSchema !== 'object' || childSchema === null) continue;

    const optional = isFieldOptional(childSchema);
    const hasDefault = Object.prototype.hasOwnProperty.call(childSchema, '$default');
    const hasParentDefault = parentDefObj && Object.prototype.hasOwnProperty.call(parentDefObj, key);

    // ── 字段缺失时的填充逻辑 ──
    // 优先级：子 $default > 父 $default > [Var_Default]（已合入子 $default）> null
    if (!Object.prototype.hasOwnProperty.call(result, key)) {
      if (opts.mode === 'insert') {
        // insert / Initial：有 $default 就填（含 optional），无 $default 且非可选填 null
        if (hasDefault) {
          result[key] = cloneDeep(childSchema.$default);
        } else if (hasParentDefault) {
          result[key] = cloneDeep(parentDefObj[key]);
        } else if (!optional) {
          result[key] = null;
        }
      } else {
        // replace：先尝试从旧值恢复；无旧值的非可选字段用 $default 兜底
        if (oldObj && Object.prototype.hasOwnProperty.call(oldObj, key)) {
          result[key] = cloneDeep(oldObj[key]);
        } else if (!optional) {
          // 非可选字段：子 $default → 父 $default → null
          if (hasDefault) {
            result[key] = cloneDeep(childSchema.$default);
          } else if (hasParentDefault) {
            result[key] = cloneDeep(parentDefObj[key]);
          } else {
            result[key] = null;
          }
        }
        // 可选字段无旧值：不填（保持缺失）
      }
    }

    // ── 递归处理已存在的子值 ──
    const childVal = result[key];
    if (childVal !== null && childVal !== undefined) {
      // 对象子字段递归
      if (typeof childVal === 'object' && !Array.isArray(childVal)) {
        const childOld = oldObj?.[key];
        result[key] = fillDefaultsForValue(childVal, childSchema, schemaRaw, {
          mode: opts.mode,
          oldValue: childOld,
        });
      }

      // 数组元素递归（每个元素视为 insert）
      if (Array.isArray(childVal)) {
        const typeStr = childSchema.$type;
        if (typeof typeStr === 'string') {
          const arrMatch = typeStr.trim().match(ARRAY_TYPE_RE);
          if (arrMatch) {
            const elemSchema = resolveTypeToSchemaNode(schemaRaw, arrMatch[1]);
            for (let i = 0; i < childVal.length; i++) {
              if (childVal[i] !== null && typeof childVal[i] === 'object' && !Array.isArray(childVal[i])) {
                childVal[i] = fillDefaultsForValue(childVal[i], elemSchema, schemaRaw, { mode: 'insert' });
              }
            }
          }
        }
      }

      // record 值递归（每个值视为 insert）
      if (typeof childVal === 'object' && !Array.isArray(childVal)) {
        const typeStr = childSchema.$type;
        if (typeof typeStr === 'string') {
          const recMatch = typeStr.trim().match(RECORD_TYPE_RE);
          if (recMatch) {
            const valSchema = resolveTypeToSchemaNode(schemaRaw, recMatch[1]);
            for (const recKey of Object.keys(childVal)) {
              const recVal = childVal[recKey];
              if (recVal !== null && typeof recVal === 'object' && !Array.isArray(recVal)) {
                childVal[recKey] = fillDefaultsForValue(recVal, valSchema, schemaRaw, { mode: 'insert' });
              }
            }
          }
        }
      }
    }
  }

  return result;
}
