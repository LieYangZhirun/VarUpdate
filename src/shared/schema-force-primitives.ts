/**
 * Schema 中允许使用 `(force)` 后缀的基础类型名（小写）。
 * 仅 number / integer / string 三种；与 schema-to-zod 的 switch 分支一致。
 */

export const FORCE_PRIMITIVE_NAMES_LOWER = new Set([
  'number(force)',
  'integer(force)',
  'string(force)',
]);
