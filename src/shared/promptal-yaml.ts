/**
 * shared/promptal-yaml.ts
 *
 * PromptalYAML 序列化器 —— AI 提示词友好的结构化文本格式
 *
 * 以 YAML 的缩进键值对语法为基础，针对 AI 上下文注入场景做针对性改造：
 * - 键名和字符串值均不加引号
 * - 基础类型数组使用内联格式 [a, b, c]
 * - 复合类型数组使用展开格式（- 前缀）
 * - 空集合统一为 [] 和 {}
 * - 多行字符串默认用 ``` 围栏包裹；去前导空白后以 ``` 起首的，只加行首缩进、不另加外层围栏
 * - 布尔值和数值直接输出字面量
 *
 * @module promptal-yaml
 */

const INDENT_UNIT = '  '; // 两空格缩进

/**
 * 将 JavaScript 值序列化为 PromptalYAML 格式文本
 *
 * @param value 要序列化的值（任意类型）
 * @param indentLevel 起始缩进层级（默认 0）
 * @returns PromptalYAML 格式文本
 */
export function serializeToPromptalYAML(value: any, indentLevel: number = 0): string {
  // null / undefined → 空字符串
  if (value === null || value === undefined) {
    return '';
  }

  // 基础类型直接输出
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (typeof value === 'string') {
    return serializeString(value, indentLevel);
  }

  if (Array.isArray(value)) {
    return serializeArray(value, indentLevel);
  }

  if (typeof value === 'object') {
    return serializeObject(value, indentLevel);
  }

  // 其他类型 fallback
  return String(value);
}

/**
 * 序列化字符串值
 *
 * - 单行字符串：直接输出（不加引号）
 * - 多行字符串：默认 ``` 围栏包裹
 * - `trimStart()` 后以 ``` 起首：按 indentLevel 为各行加缩进，不另加外层 ```
 */
function serializeString(value: string, indentLevel: number): string {
  if (!value.includes('\n')) {
    // 单行字符串：直接输出
    return value;
  }

  const indent = INDENT_UNIT.repeat(indentLevel);
  const lines = value.split('\n');

  if (value.trimStart().startsWith('```')) {
    return '\n' + lines.map(line => indent + line).join('\n');
  }

  const fencedLines = [
    '```',
    ...lines.map(line => indent + line),
    indent + '```',
  ];
  return '\n' + indent + fencedLines.join('\n');
}

/**
 * 序列化数组
 *
 * - 空数组 → []
 * - 全部基础类型元素 → 内联格式 [a, b, c]
 * - 含复合类型元素 → 展开格式（- 前缀）
 */
function serializeArray(arr: any[], indentLevel: number): string {
  if (arr.length === 0) {
    return '[]';
  }

  // 判断是否全为基础类型
  const allPrimitive = arr.every(item => isPrimitive(item));

  if (allPrimitive) {
    // 内联格式：[a, b, c]
    const items = arr.map(item => formatPrimitiveValue(item));
    return '[' + items.join(', ') + ']';
  }

  // 展开格式
  const indent = INDENT_UNIT.repeat(indentLevel);
  const lines: string[] = [];

  for (const item of arr) {
    if (isPrimitive(item)) {
      lines.push(indent + '- ' + formatPrimitiveValue(item));
    } else if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      // 对象元素：第一个键与 - 同行，后续键缩进对齐
      const entries = Object.entries(item);
      if (entries.length === 0) {
        lines.push(indent + '- {}');
      } else {
        const [firstKey, firstVal] = entries[0];
        const firstValStr = serializeValue(firstVal, indentLevel + 1);
        lines.push(indent + '- ' + firstKey + ': ' + firstValStr);

        for (let i = 1; i < entries.length; i++) {
          const [key, val] = entries[i];
          const valStr = serializeValue(val, indentLevel + 1);
          lines.push(indent + '  ' + key + ': ' + valStr);
        }
      }
    } else {
      // 数组中的数组或其他复合类型
      const serialized = serializeToPromptalYAML(item, indentLevel + 1);
      lines.push(indent + '- ' + serialized);
    }
  }

  return lines.join('\n');
}

/**
 * 序列化对象
 *
 * - 空对象 → {}
 * - 非空对象 → 键值对格式，嵌套层级缩进
 */
function serializeObject(obj: Record<string, any>, indentLevel: number): string {
  const entries = Object.entries(obj);

  if (entries.length === 0) {
    return '{}';
  }

  const indent = INDENT_UNIT.repeat(indentLevel);
  const lines: string[] = [];

  for (const [key, value] of entries) {
    const valStr = serializeValue(value, indentLevel);
    // 复合类型值以换行开头 → 冒号后直接跟换行（不加空格）
    if (valStr.startsWith('\n')) {
      lines.push(indent + key + ':' + valStr);
    } else {
      lines.push(indent + key + ': ' + valStr);
    }
  }

  return lines.join('\n');
}

/**
 * 序列化一个值，处理嵌套的缩进
 *
 * 如果值是复合类型（对象/数组），需要换行并增加缩进层级。
 * 如果值是基础类型，直接输出。
 */
function serializeValue(value: any, indentLevel: number): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (isPrimitive(value)) {
    return formatPrimitiveValue(value);
  }

  if (typeof value === 'string' && value.includes('\n')) {
    return serializeString(value, indentLevel + 1);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every(item => isPrimitive(item))) {
      // 内联格式数组
      return '[' + value.map(formatPrimitiveValue).join(', ') + ']';
    }
    // 展开格式数组需要换行
    return '\n' + serializeArray(value, indentLevel + 1);
  }

  if (typeof value === 'object') {
    if (Object.keys(value).length === 0) return '{}';
    // 嵌套对象需要换行
    return '\n' + serializeObject(value, indentLevel + 1);
  }

  return String(value);
}

/**
 * 判断值是否为基础类型（number / string(单行) / boolean / null / undefined）
 */
function isPrimitive(value: any): boolean {
  if (value === null || value === undefined) return true;
  const t = typeof value;
  if (t === 'number' || t === 'boolean') return true;
  if (t === 'string' && !value.includes('\n')) return true;
  return false;
}

/**
 * 格式化基础类型值为字符串表示
 *
 * - 字符串不加引号
 * - 数值和布尔值直接转字符串
 * - null/undefined → 空字符串
 */
function formatPrimitiveValue(value: any): string {
  if (value === null || value === undefined) return '';
  return String(value);
}
