/**
 * tests/schema-compiler-index.test.ts
 *
 * 测试 schema-compiler/index.ts 的封装层逻辑：
 * - 缓存命中 / clearCache
 * - compileSchemaFromData 跳过文本解析
 * - bindSafeParseWithContext 闭包绑定
 * - getCachedSchema 状态查询
 *
 * 见审计报告改进项 #3 和测试规范 §4.2。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  compileSchemaFromData,
  clearCache,
  getCachedSchema,
  validate,
  bindSafeParseWithContext,
} from '../src/modules/schema-compiler/index';
import type { ValidationContext } from '../src/modules/schema-compiler/schema-to-zod';

// Mock 通知模块（阻止实际的 toastr / console 输出）
vi.mock('../src/modules/notification', () => ({
  error: vi.fn(),
  success: vi.fn(),
  trace: vi.fn(),
}));

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

describe('schema-compiler/index.ts 封装层', () => {
  const simpleSchemaData = {
    HP: { $type: 'number', $min: 0, $max: 100 },
    名称: { $type: 'string' },
  };

  beforeEach(() => {
    clearCache();
  });

  // ═══════════════════════════════════════════
  //  compileSchemaFromData
  // ═══════════════════════════════════════════
  describe('compileSchemaFromData', () => {
    it('编译成功 → 返回 CompiledSchema 对象', () => {
      const compiled = compileSchemaFromData(simpleSchemaData);
      expect(compiled).toBeDefined();
      expect(compiled.validator).toBeDefined();
      expect(compiled.defNames).toBeInstanceOf(Array);
    });

    it('非法 Schema → 抛出错误', () => {
      expect(() => compileSchemaFromData({
        broken: { $type: 'array<不存在的类型>' },
      })).toThrow();
    });
  });

  // ═══════════════════════════════════════════
  //  缓存逻辑
  // ═══════════════════════════════════════════
  describe('缓存', () => {
    it('相同数据第二次编译 → 返回缓存对象（引用相等）', () => {
      const first = compileSchemaFromData(simpleSchemaData);
      const second = compileSchemaFromData(simpleSchemaData);
      expect(first).toBe(second); // 引用相等 = 缓存命中
    });

    it('不同数据 → 返回新编译对象（引用不等）', () => {
      const first = compileSchemaFromData(simpleSchemaData);
      const second = compileSchemaFromData({
        HP: { $type: 'number' },
      });
      expect(first).not.toBe(second);
    });

    it('clearCache 后重新编译 → 返回新对象', () => {
      const first = compileSchemaFromData(simpleSchemaData);
      clearCache();
      const second = compileSchemaFromData(simpleSchemaData);
      expect(first).not.toBe(second); // 虽然数据相同，但缓存已清除
    });
  });

  // ═══════════════════════════════════════════
  //  getCachedSchema
  // ═══════════════════════════════════════════
  describe('getCachedSchema', () => {
    it('初始状态（未编译）→ 返回 null', () => {
      expect(getCachedSchema()).toBeNull();
    });

    it('编译后 → 返回当前缓存的 Schema', () => {
      const compiled = compileSchemaFromData(simpleSchemaData);
      expect(getCachedSchema()).toBe(compiled);
    });

    it('clearCache 后 → 返回 null', () => {
      compileSchemaFromData(simpleSchemaData);
      clearCache();
      expect(getCachedSchema()).toBeNull();
    });
  });

  // ═══════════════════════════════════════════
  //  validate
  // ═══════════════════════════════════════════
  describe('validate', () => {
    it('合法数据 → success: true', () => {
      const compiled = compileSchemaFromData(simpleSchemaData);
      const result = validate(compiled, { HP: 50, 名称: '英雄' }, mockContext());
      expect(result.success).toBe(true);
    });

    it('非法数据 → success: false', () => {
      const compiled = compileSchemaFromData(simpleSchemaData);
      const result = validate(compiled, { HP: 'invalid', 名称: 42 }, mockContext());
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ═══════════════════════════════════════════
  //  bindSafeParseWithContext
  // ═══════════════════════════════════════════
  describe('bindSafeParseWithContext', () => {
    it('绑定后返回可复用的校验函数', () => {
      const compiled = compileSchemaFromData(simpleSchemaData);
      const safeParse = bindSafeParseWithContext(compiled, mockContext());
      expect(typeof safeParse).toBe('function');

      const result = safeParse({ HP: 50, 名称: '测试' });
      expect(result.success).toBe(true);
    });

    it('绑定 undefined context → 不抛错（兼容模式）', () => {
      const compiled = compileSchemaFromData(simpleSchemaData);
      const safeParse = bindSafeParseWithContext(compiled, undefined);
      const result = safeParse({ HP: 50, 名称: '测试' });
      expect(result.success).toBe(true);
    });

    it('绑定带 refer() 的 Schema → context 生效', () => {
      const schemaData = {
        HP: { $type: 'number', $max: 'refer(HPMax)' },
        HPMax: { $type: 'number' },
      };
      const compiled = compileSchemaFromData(schemaData);

      // context 提供 HPMax = 100
      const data = { HP: 120, HPMax: 100 };
      const ctx = mockContext(data);
      const safeParse = bindSafeParseWithContext(compiled, ctx);
      const result = safeParse(data);
      expect(result.success).toBe(false); // HP 超过 refer(HPMax)=100

      // HP 在范围内
      const dataOk = { HP: 80, HPMax: 100 };
      const ctxOk = mockContext(dataOk);
      const safeParseOk = bindSafeParseWithContext(compiled, ctxOk);
      expect(safeParseOk(dataOk).success).toBe(true);
    });
  });
});
