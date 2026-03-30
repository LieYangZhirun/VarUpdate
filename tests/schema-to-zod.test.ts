import { describe, it, expect } from 'vitest';
import { compileSchema, validateWithSchema, SchemaCompileError, safeParseWithContext } from '../src/modules/schema-compiler/schema-to-zod';
import type { ValidationContext } from '../src/modules/schema-compiler/schema-to-zod';

/** 创建一个简单的 ValidationContext mock */
function mockContext(data: Record<string, any> = {}): ValidationContext {
  return {
    resolveRef: (path: string) => {
      const parts = path.split('/');
      let val: any = data;
      for (const p of parts) {
        if (val === undefined || val === null) return undefined;
        val = val[p];
      }
      return val;
    },
  };
}

describe('schema-to-zod', () => {
  // ═══════════════════════════════════════════
  //  基础类型映射
  // ═══════════════════════════════════════════
  describe('基础类型映射', () => {
    it('$type: number → z.number()', () => {
      const schema = compileSchema({ HP: { $type: 'number' } });
      const result = validateWithSchema(schema, { HP: 80 }, mockContext());
      expect(result.success).toBe(true);

      const fail = validateWithSchema(schema, { HP: 'abc' }, mockContext());
      expect(fail.success).toBe(false);
    });

    it('$type: integer → z.number().int()', () => {
      const schema = compileSchema({ level: { $type: 'integer' } });
      expect(validateWithSchema(schema, { level: 5 }, mockContext()).success).toBe(true);
      expect(validateWithSchema(schema, { level: 5.5 }, mockContext()).success).toBe(false);
    });

    it('$type: string → z.string()', () => {
      const schema = compileSchema({ name: { $type: 'string' } });
      expect(validateWithSchema(schema, { name: '英雄' }, mockContext()).success).toBe(true);
      expect(validateWithSchema(schema, { name: 42 }, mockContext()).success).toBe(false);
    });

    it('$type: boolean → z.boolean()', () => {
      const schema = compileSchema({ active: { $type: 'boolean' } });
      expect(validateWithSchema(schema, { active: true }, mockContext()).success).toBe(true);
    });

    it('$type: any → z.any()', () => {
      const schema = compileSchema({ data: { $type: 'any' } });
      expect(validateWithSchema(schema, { data: 42 }, mockContext()).success).toBe(true);
      expect(validateWithSchema(schema, { data: 'test' }, mockContext()).success).toBe(true);
      expect(validateWithSchema(schema, { data: null }, mockContext()).success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════
  //  force 变体
  // ═══════════════════════════════════════════
  describe('force 变体', () => {
    it('number(force) + 字符串 "42" → 通过', () => {
      const schema = compileSchema({ HP: { $type: 'number(force)' } });
      expect(validateWithSchema(schema, { HP: '42' }, mockContext()).success).toBe(true);
      expect(validateWithSchema(schema, { HP: 42 }, mockContext()).success).toBe(true);
    });

    it('string(force) + 数字 42 → 通过', () => {
      const schema = compileSchema({ label: { $type: 'string(force)' } });
      expect(validateWithSchema(schema, { label: 42 }, mockContext()).success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════
  //  复合类型
  // ═══════════════════════════════════════════
  describe('复合类型', () => {
    it('array<number> → z.array(z.number())', () => {
      const schema = compileSchema({ scores: { $type: 'array<number>' } });
      expect(validateWithSchema(schema, { scores: [1, 2, 3] }, mockContext()).success).toBe(true);
      expect(validateWithSchema(schema, { scores: [1, 'a'] }, mockContext()).success).toBe(false);
    });

    it('record<string> → z.record(z.string())', () => {
      const schema = compileSchema({ tags: { $type: 'record<string>' } });
      expect(validateWithSchema(schema, { tags: { a: 'x', b: 'y' } }, mockContext()).success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════
  //  约束
  // ═══════════════════════════════════════════
  describe('约束', () => {
    it('$min / $max → 数值范围校验', () => {
      const schema = compileSchema({ HP: { $type: 'number', $min: 0, $max: 100 } });
      expect(validateWithSchema(schema, { HP: 50 }, mockContext()).success).toBe(true);
      expect(validateWithSchema(schema, { HP: -1 }, mockContext()).success).toBe(false);
      expect(validateWithSchema(schema, { HP: 101 }, mockContext()).success).toBe(false);
    });

    it('$optional → .optional()', () => {
      const schema = compileSchema({ nickname: { $type: 'string', $optional: true } });
      expect(validateWithSchema(schema, {}, mockContext()).success).toBe(true);
      expect(validateWithSchema(schema, { nickname: '英雄' }, mockContext()).success).toBe(true);
    });

    it('$default → .default(value)', () => {
      const schema = compileSchema({ status: { $type: 'string', $default: '正常' } });
      // 缺少字段时用默认值（Zod 的 .default() 行为）
      expect(validateWithSchema(schema, {}, mockContext()).success).toBe(true);
    });

    it('$regex → 正则校验', () => {
      const schema = compileSchema({ code: { $type: 'string', $regex: '^[A-Z]{3}$' } });
      expect(validateWithSchema(schema, { code: 'ABC' }, mockContext()).success).toBe(true);
      expect(validateWithSchema(schema, { code: 'abc' }, mockContext()).success).toBe(false);
    });

    it('$enum → 枚举校验', () => {
      const schema = compileSchema({ color: { $type: 'string', $enum: ['red', 'green', 'blue'] } });
      expect(validateWithSchema(schema, { color: 'red' }, mockContext()).success).toBe(true);
      expect(validateWithSchema(schema, { color: 'yellow' }, mockContext()).success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════
  //  $defs
  // ═══════════════════════════════════════════
  describe('$defs', () => {
    it('定义结构体 + 引用', () => {
      const schema = compileSchema({
        $defs: {
          Item: { name: { $type: 'string' }, count: { $type: 'number' } },
        },
        inventory: { $type: 'array<Item>' },
      });
      const result = validateWithSchema(
        schema,
        { inventory: [{ name: '铁剑', count: 1 }] },
        mockContext()
      );
      expect(result.success).toBe(true);
    });

    it('引用不存在的结构体 → SchemaCompileError', () => {
      expect(() => compileSchema({
        inventory: { $type: 'array<UnknownType>' },
      })).toThrow(SchemaCompileError);
    });
  });

  // ═══════════════════════════════════════════
  //  refer()
  // ═══════════════════════════════════════════
  describe('refer()', () => {
    it('refer(path) 作为 $max 值 → 延迟求值', () => {
      const schema = compileSchema({
        HP: { $type: 'number', $max: 'refer(HPMax)' },
        HPMax: { $type: 'number' },
      });

      const ctx = mockContext({ HPMax: 100 });
      expect(validateWithSchema(schema, { HP: 80, HPMax: 100 }, ctx).success).toBe(true);
      expect(validateWithSchema(schema, { HP: 120, HPMax: 100 }, ctx).success).toBe(false);
    });

    it('refer() 引用不存在的路径 → 静默跳过', () => {
      const schema = compileSchema({
        HP: { $type: 'number', $max: 'refer(不存在/路径)' },
      });
      // 引用不存在 → 约束不生效 → 通过
      expect(validateWithSchema(schema, { HP: 99999 }, mockContext()).success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════
  //  嵌套对象
  // ═══════════════════════════════════════════
  describe('嵌套对象', () => {
    it('无 $type 的嵌套对象 → 递归编译', () => {
      const schema = compileSchema({
        角色: {
          HP: { $type: 'number' },
          名称: { $type: 'string' },
        },
      });
      expect(validateWithSchema(schema, { 角色: { HP: 80, 名称: '英雄' } }, mockContext()).success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════
  //  错误收集
  // ═══════════════════════════════════════════
  describe('错误收集', () => {
    it('多个错误一次性收集', () => {
      const schema = compileSchema({
        HP: { $type: 'number', $min: 0 },
        名称: { $type: 'string' },
      });
      const result = validateWithSchema(schema, { HP: 'invalid', 名称: 42 }, mockContext());
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('refer() 与 safeParseWithContext', () => {
    it('无 context 的 safeParse 不应用 refer（设计：静默跳过）', () => {
      const schema = compileSchema({
        角色: {
          $type: 'object',
          HP: { $type: 'number', $max: 'refer(角色/HP上限)' },
          HP上限: { $type: 'number', $default: 50 },
        },
      });
      const data = { 角色: { HP: 999, HP上限: 50 } };
      const direct = schema.validator.safeParse(data);
      expect(direct.success).toBe(true);
    });

    it('safeParseWithContext 下 refer(路径) 按当前数据限制数值', () => {
      const schema = compileSchema({
        角色: {
          $type: 'object',
          HP: { $type: 'number', $max: 'refer(角色/HP上限)' },
          HP上限: { $type: 'number', $default: 50 },
        },
      });
      const data = { 角色: { HP: 999, HP上限: 50 } };
      const ctx = mockContext(data);
      const r = safeParseWithContext(schema, data, ctx);
      expect(r.success).toBe(false);

      const ok = safeParseWithContext(schema, { 角色: { HP: 40, HP上限: 50 } }, mockContext({ 角色: { HP: 40, HP上限: 50 } }));
      expect(ok.success).toBe(true);
    });
  });
});
