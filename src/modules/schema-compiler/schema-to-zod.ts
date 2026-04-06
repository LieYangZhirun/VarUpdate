/**
 * schema-to-zod
 *
 * 声明式 Schema → Zod 编译器
 *
 * @module schema-to-zod
 */

// z（Zod）由宿主注入全局，无 import；下列为项目内依赖。
import { FORCE_PRIMITIVE_NAMES_LOWER } from '../../shared/schema-force-primitives.js';
import { wildcardMatch } from '../../shared/wildcard.js';
import { ScriptError } from '../../types/index.js';

// ═══════════════════════════════════════════
//  公开类型
// ═══════════════════════════════════════════

export interface CompiledSchema {
  validator: z.ZodType<any>;
  raw: Record<string, any>;
  defNames: string[];
}

export interface ValidationContext {
  resolveRef: (path: string) => any;
}

export interface ValidationResult {
  success: boolean;
  errors: Array<{ path: string; message: string; expected: string; received: any }>;
}

export class SchemaCompileError extends ScriptError {
  constructor(
    message: string,
    public readonly errors: Array<{ path: string; message: string }> = []
  ) {
    super(message, { errors });
    this.name = 'SchemaCompileError';
  }
}

// ═══════════════════════════════════════════
//  全局编译状态（每次 compileSchema 重置）
// ═══════════════════════════════════════════

let _defRegistry: Map<string, z.ZodType> = new Map();
let _ctx: ValidationContext | null = null;
let _compileErrors: Array<{ path: string; message: string }> = [];

// ═══════════════════════════════════════════
//  主入口
// ═══════════════════════════════════════════

/** $defs 多轮编译最大轮数：解决前向引用（被引用 def 在文件中排在后） */
const MAX_DEF_COMPILE_ROUNDS = 5;

export function compileSchema(schemaData: Record<string, any>): CompiledSchema {
  _defRegistry = new Map();
  _compileErrors = [];
  const defNames: string[] = [];

  if (schemaData.$defs && typeof schemaData.$defs === 'object') {
    const defEntries = Object.entries(schemaData.$defs);
    for (const [name] of defEntries) defNames.push(name);

    const pending = new Set(defEntries.map(([name]) => name));
    const lastFailMessage = new Map<string, string>();

    for (let round = 0; round < MAX_DEF_COMPILE_ROUNDS && pending.size > 0; round++) {
      const succeededThisRound: string[] = [];
      const roundFailures: Array<{ name: string; message: string }> = [];

      for (const [name, def] of defEntries) {
        if (!pending.has(name)) continue;
        try {
          const zod = compileNode(def as Record<string, any>, `$defs/${name}`);
          _defRegistry.set(name, zod);
          succeededThisRound.push(name);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          lastFailMessage.set(name, message);
          roundFailures.push({ name, message });
        }
      }

      for (const n of succeededThisRound) pending.delete(n);

      if (pending.size === 0) break;

      if (succeededThisRound.length === 0) {
        for (const f of roundFailures) {
          _compileErrors.push({ path: `$defs/${f.name}`, message: `结构体编译失败: ${f.message}` });
        }
        break;
      }
    }

    if (pending.size > 0 && _compileErrors.length === 0) {
      for (const name of pending) {
        _compileErrors.push({
          path: `$defs/${name}`,
          message: `结构体编译失败: ${lastFailMessage.get(name) ?? '超过多轮编译上限仍未能解析依赖'}`,
        });
      }
    }
  }

  const mainEntries: Record<string, z.ZodType> = {};
  for (const [key, value] of Object.entries(schemaData)) {
    if (key === '$defs') continue;
    try {
      mainEntries[key] = compileNode(value, key);
    } catch (e) {
      _compileErrors.push({ path: key, message: (e as Error).message });
    }
  }

  if (_compileErrors.length > 0) {
    throw new SchemaCompileError(`Schema 编译产生 ${_compileErrors.length} 个错误`, _compileErrors);
  }

  return { validator: z.object(mainEntries).strict(), raw: schemaData, defNames };
}

/**
 * 在提供 ValidationContext 时执行 safeParse，使 refer() 约束能读取当前变量状态。
 * 必须使用本函数（或 validateWithSchema），不可对带 refer 的 validator 直接 safeParse。
 */
export function safeParseWithContext(
  schema: CompiledSchema,
  data: unknown,
  context: ValidationContext | null,
): ReturnType<z.ZodTypeAny['safeParse']> {
  _ctx = context;
  try {
    return schema.validator.safeParse(data);
  } finally {
    _ctx = null;
  }
}

export function validateWithSchema(
  schema: CompiledSchema,
  data: Record<string, any>,
  context: ValidationContext
): ValidationResult {
  const result = safeParseWithContext(schema, data, context);

  if (result.success) return { success: true, errors: [] };
  return {
    success: false,
    errors: result.error!.issues.map(issue => ({
      path: issue.path.join('/'),
      message: issue.message,
      expected: issue.code,
      received: (issue as any).received ?? undefined,
    })),
  };
}

// ═══════════════════════════════════════════
//  节点编译器
// ═══════════════════════════════════════════

function compileNode(node: any, path: string): z.ZodType<any> {
  if (typeof node === 'string') return resolveType(node, path);
  if (typeof node !== 'object' || node === null) return z.literal(node);
  if (node.$type !== undefined) return compileTypedNode(node, path);

  // 无 $type → 隐式 object，编译子字段后仍需处理 $optional、$hide 等约束
  const shape = compileObjectShape(node, path);
  return applyConstraints(shape, node, path);
}

/**
 * S1 修复：编译 object 节点的子字段
 * 从节点中提取所有非 $ 前缀键，递归编译为 z.object shape。
 */
function compileObjectShape(node: Record<string, any>, path: string): z.ZodType<any> {
  const shape: Record<string, z.ZodType> = {};
  let isExtensible = false;

  for (const [key, value] of Object.entries(node)) {
    if (key === '$extensible') { isExtensible = value as boolean; continue; }
    if (key.startsWith('$')) continue;
    shape[key] = compileNode(value, `${path}/${key}`);
  }

  return isExtensible ? z.object(shape).passthrough() : z.object(shape).strict();
}

/**
 * S1 修复：当 $type === 'object' 时，编译子字段而非返回空对象
 */
function compileTypedNode(node: Record<string, any>, path: string): z.ZodType<any> {
  const typeSpec = node.$type;
  let zodType: z.ZodType<any>;

  if (Array.isArray(typeSpec)) {
    const types = typeSpec.map((t: any, i: number) =>
      typeof t === 'string' ? resolveType(t, `${path}/$type[${i}]`) : compileNode(t, `${path}/$type[${i}]`)
    );
    zodType = types.length === 1 ? types[0] : z.union(types as [z.ZodType, z.ZodType, ...z.ZodType[]]);
  } else if (typeof typeSpec === 'string' && typeSpec.trim().toLowerCase() === 'object') {
    // $type: object → 编译子字段为 shape（而非空对象）
    zodType = compileObjectShape(node, path);
  } else {
    zodType = resolveType(typeSpec, path);
  }

  zodType = applyConstraints(zodType, node, path);
  return zodType;
}

// ═══════════════════════════════════════════
//  类型解析
// ═══════════════════════════════════════════

function resolveType(typeStr: string, path: string): z.ZodType<any> {
  const trimmed = typeStr.trim();

  const arrayMatch = trimmed.match(/^array<(.+)>$/i);
  if (arrayMatch) return z.array(resolveTypeOrDef(arrayMatch[1].trim(), `${path}/array`));

  const recordMatch = trimmed.match(/^record<(.+)>$/i);
  if (recordMatch) return z.record(z.string(), resolveTypeOrDef(recordMatch[1].trim(), `${path}/record`));

  switch (trimmed.toLowerCase()) {
    case 'number':        return z.number();
    case 'number(force)': return z.preprocess(val => (typeof val === 'string' ? Number(val) : val), z.number());
    case 'integer':       return z.number().int();
    case 'integer(force)': return z.preprocess(val => { const n = typeof val === 'string' ? Number(val) : val; return typeof n === 'number' && Number.isInteger(n) ? n : val; }, z.number().int());
    case 'string':        return z.string();
    case 'string(force)': return z.coerce.string();
    case 'boolean':       return z.boolean();
    case 'any':           return z.any();
    // 裸 'object' 类型（非 compileTypedNode 中带子字段的 $type:object）：允许任意键
    case 'object':        return z.object({}).passthrough();
    default:              return resolveDefRef(trimmed, path);
  }
}

function resolveTypeOrDef(name: string, path: string): z.ZodType<any> {
  const lower = name.toLowerCase();
  if (['number', 'integer', 'string', 'boolean', 'any'].includes(lower) || FORCE_PRIMITIVE_NAMES_LOWER.has(lower)) {
    return resolveType(name, path);
  }
  return resolveDefRef(name, path);
}

function resolveDefRef(name: string, path: string): z.ZodType<any> {
  const zodType = _defRegistry.get(name);
  if (zodType) return zodType;
  throw new SchemaCompileError(`引用不存在的结构体: "${name}"`, [{ path, message: `"${name}" 不是基础类型也不在 $defs 中` }]);
}

// ═══════════════════════════════════════════
//  约束应用（含 S2 $either、S3 $! 前缀）
// ═══════════════════════════════════════════

function applyConstraints(baseType: z.ZodType<any>, node: Record<string, any>, path: string): z.ZodType<any> {
  let t = baseType;

  // 收集所有约束键（含 $! 取反前缀）
  for (const [key, value] of Object.entries(node)) {
    if (!key.startsWith('$') || key === '$type' || key === '$extensible') continue;

    // S3: 检测 $! 前缀（取反）
    const isNegated = key.startsWith('$!');
    const baseKey = isNegated ? '$' + key.slice(2) : key;

    switch (baseKey) {
      case '$min':
        t = wrapNegate(applyMinMax(t, 'min', value, path), isNegated);
        break;
      case '$max':
        t = wrapNegate(applyMinMax(t, 'max', value, path), isNegated);
        break;
      case '$minLength':
        t = wrapNegate(applyMinMax(t, 'min', value, path), isNegated);
        break;
      case '$maxLength':
        t = wrapNegate(applyMinMax(t, 'max', value, path), isNegated);
        break;
      case '$minItems':
        t = wrapNegate(applyMinMax(t, 'min', value, path), isNegated);
        break;
      case '$maxItems':
        t = wrapNegate(applyMinMax(t, 'max', value, path), isNegated);
        break;
      case '$enum':
        if (Array.isArray(value)) t = wrapNegate(applyEnum(t, value), isNegated);
        break;
      case '$regex':
        t = wrapNegate(applyRegex(t, value, path), isNegated);
        break;
      case '$key_rule':
        t = applyKeyRule(t, value, path);
        break;
      case '$either':
        // S2: OR 逻辑
        if (Array.isArray(value)) t = applyEither(t, value, path);
        break;
      case '$optional':
        if (value === true) t = t.optional() as any;
        break;
      case '$default':
        // $default 值保留在 raw Schema 中，由应用层按操作上下文（insert/replace/delete）手动填充。
        // 不通过 Zod .default() 自动回填，避免校验时无差别地填入默认值。
        break;
      case '$hide':
        // 仅用于 VarUpdate 宏导出裁剪，不参与 Zod
        break;
      // $defs 在 compileSchema 顶层处理，此处忽略
      case '$defs':
        break;
    }
  }

  return t;
}

/**
 * S3: 将 refine 结果取反
 *
 * 保留 baseType 的类型信息（而非退化为 z.any()），
 * 使取反约束仍能由 Zod 推断出底层类型。
 */
function wrapNegate(zodType: z.ZodType<any>, negate: boolean): z.ZodType<any> {
  if (!negate) return zodType;
  // 取反逻辑：在原始 zodType 上追加 refine，校验通过则视为不满足
  const original = zodType;
  return original.refine(
    (val: any) => {
      // 对自身 refine 套 safeParse 会循环；此处拆解：
      // original 中已有的 refine 约束通过时，取反应失败。
      // 用 catch 兜底：若 safeParse 内部出错则放行（保守策略）。
      try {
        return !original.safeParse(val).success;
      } catch {
        return true;
      }
    },
    { message: '取反约束未满足（$! 前缀）' },
  ) as any;
}

// ═══════════════════════════════════════════
//  各约束实现
// ═══════════════════════════════════════════

function applyMinMax(t: z.ZodType<any>, op: 'min' | 'max', value: any, path: string): z.ZodType<any> {
  const referPath = extractRefer(value);
  if (referPath) {
    return t.refine(
      (val: any) => {
        if (!_ctx) return true;
        const refVal = _ctx.resolveRef(referPath);
        if (typeof refVal !== 'number') return true;
        if (typeof val === 'number') return op === 'min' ? val >= refVal : val <= refVal;
        const len = getLength(val);
        return len !== null ? (op === 'min' ? len >= refVal : len <= refVal) : true;
      },
      { message: `${op} 约束未满足（refer: ${referPath}）` }
    ) as any;
  }

  if (typeof value === 'number') {
    if ('min' in t && typeof (t as any).min === 'function') {
      return op === 'min' ? (t as any).min(value) : (t as any).max(value);
    }
    return t.refine(
      (val: any) => {
        if (typeof val === 'number') return op === 'min' ? val >= value : val <= value;
        const len = getLength(val);
        return len !== null ? (op === 'min' ? len >= value : len <= value) : true;
      },
      { message: `${op} 约束未满足: ${value}` }
    ) as any;
  }
  return t;
}

/**
 * S4: 使用通配符匹配算法
 */
function applyEnum(t: z.ZodType<any>, values: any[]): z.ZodType<any> {
  return t.refine(
    (val: any) => values.some(enumVal => {
      if (typeof enumVal === 'string' && enumVal.includes('*') && typeof val === 'string') {
        return wildcardMatch(enumVal, val);
      }
      // eslint-disable-next-line eqeqeq
      return val == enumVal;
    }),
    { message: `值不在枚举范围内: [${values.join(', ')}]` }
  ) as any;
}

function applyRegex(t: z.ZodType<any>, pattern: string, path: string): z.ZodType<any> {
  try {
    const regex = new RegExp(pattern);
    return t.refine(
      (val: any) => typeof val === 'string' && regex.test(val),
      { message: `不匹配正则: ${pattern}` }
    ) as any;
  } catch {
    _compileErrors.push({ path, message: `无效正则表达式: ${pattern}` });
    return t;
  }
}

function applyKeyRule(t: z.ZodType<any>, rule: any, path: string): z.ZodType<any> {
  if (typeof rule !== 'object' || rule === null) return t;

  // 将 $key_rule 下的所有子属性当作一套约束集，编译出一个 z.string() 校验器
  // 然后用这个校验器去 refine 字典的每一个键名
  let keyValidator: z.ZodType<any> = z.string();
  const ruleNode: Record<string, any> = { $type: 'string', ...rule };
  try {
    keyValidator = applyConstraints(z.string(), ruleNode, `${path}/$key_rule`);
  } catch {
    // 编译失败时退回无约束
    return t;
  }

  return t.refine(
    (val: any) => {
      if (typeof val !== 'object' || val === null) return true;
      return Object.keys(val).every(key => keyValidator.safeParse(key).success);
    },
    { message: `键名不符合 $key_rule 约束` }
  ) as any;
}

/**
 * S2: $either — OR 逻辑
 * $either 数组中的每组约束独立应用到基础类型上，满足任一组即通过。
 */
function applyEither(baseType: z.ZodType<any>, branches: any[], path: string): z.ZodType<any> {
  const branchTypes = branches.map((branch, i) => {
    if (typeof branch !== 'object' || branch === null) return baseType;
    // 将每组约束独立应用到基础类型的副本上
    return applyConstraints(baseType, branch, `${path}/$either[${i}]`);
  });

  if (branchTypes.length === 0) return baseType;
  if (branchTypes.length === 1) return branchTypes[0];

  return z.union(branchTypes as [z.ZodType, z.ZodType, ...z.ZodType[]]);
}

// wildcardMatch 已统一由 shared/wildcard.ts 提供，此处不再重复实现。

// ═══════════════════════════════════════════
//  工具函数
// ═══════════════════════════════════════════

function extractRefer(value: any): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^refer\((.+)\)$/);
  return match ? match[1].trim() : null;
}

function getLength(val: any): number | null {
  if (Array.isArray(val)) return val.length;
  if (typeof val === 'string') return val.length;
  if (typeof val === 'object' && val !== null) return Object.keys(val).length;
  return null;
}
