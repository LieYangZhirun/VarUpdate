import { describe, it, expect } from 'vitest';
import {
  filterMessageDataForMacro,
  filterValueBySchemaHide,
  getSchemaNodeAtPath,
} from '../src/shared/filter-macro-data-by-schema-hide.js';

describe('filter-macro-data-by-schema-hide', () => {
  const schemaRaw = {
    世界: {
      $type: 'object',
      公开: { $type: 'string' },
      秘密: {
        $hide: true,
        $type: 'object',
        笔记: { $type: 'string' },
      },
    },
    调查社: { $type: 'string' },
  };

  const dataRoot = {
    世界: {
      公开: '可见',
      秘密: { 笔记: '可经显式子路径注入' },
    },
    调查社: '社',
  };

  it('根路径 {{message/data}} 等价：去掉 $hide 子树', () => {
    const fr = filterMessageDataForMacro(dataRoot, schemaRaw, '');
    expect(fr.terminalHidden).toBe(false);
    const out = fr.value as Record<string, unknown>;
    expect(out.世界).toEqual({ 公开: '可见' });
    expect((out.世界 as any).秘密).toBeUndefined();
    expect(out.调查社).toBe('社');
  });

  it('子路径概括到 object：仍裁剪掉其下 $hide 分支', () => {
    const fr = filterMessageDataForMacro(dataRoot, schemaRaw, '世界');
    expect(fr.terminalHidden).toBe(false);
    const out = fr.value as Record<string, unknown>;
    expect(out.公开).toBe('可见');
    expect(out.秘密).toBeUndefined();
  });

  it('显式路径终止于 $hide 节点 → terminalHidden', () => {
    const fr = filterMessageDataForMacro(dataRoot, schemaRaw, '世界/秘密');
    expect(fr.terminalHidden).toBe(true);
    expect(fr.value).toBeUndefined();
  });

  it('显式路径深入到 $hide 节点之下的子键 → 正常取值', () => {
    const fr = filterMessageDataForMacro(dataRoot, schemaRaw, '世界/秘密/笔记');
    expect(fr.terminalHidden).toBe(false);
    expect(fr.value).toBe('可经显式子路径注入');
  });

  it('getSchemaNodeAtPath 导航', () => {
    expect(getSchemaNodeAtPath(schemaRaw, ['世界', '秘密'])).toMatchObject({ $hide: true });
  });

  it('无 Schema 节点时子树原样保留', () => {
    const data = { 世界: { 公开: 'x', 额外: 1 } };
    const schema = { 世界: { $type: 'object', 公开: { $type: 'string' } } };
    const out = filterValueBySchemaHide(schema.世界, data.世界, schema) as Record<string, unknown>;
    expect(out.额外).toBe(1);
    expect(out.公开).toBe('x');
  });
});
