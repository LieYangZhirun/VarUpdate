import { describe, it, expect } from 'vitest';
import { compileSchema, safeParseWithContext } from '../src/modules/schema-compiler/schema-to-zod';
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

describe('Number Clamp Constraints', () => {
  describe('Static Clamping', () => {
    it('should clamp number values to min constraint', () => {
      const schema = compileSchema({ 
        HP: { $type: 'number', $min: 0 } 
      });
      
      const result = safeParseWithContext(schema, { HP: -10 }, null);
      expect(result.success).toBe(true);
      expect(result.data?.HP).toBe(0); // 截断到 min 值
    });

    it('should clamp number values to max constraint', () => {
      const schema = compileSchema({ 
        HP: { $type: 'number', $max: 100 } 
      });
      
      const result = safeParseWithContext(schema, { HP: 150 }, null);
      expect(result.success).toBe(true);
      expect(result.data?.HP).toBe(100); // 截断到 max 值
    });

    it('should clamp integer values while preserving type', () => {
      const schema = compileSchema({ 
        level: { $type: 'integer', $min: 1, $max: 50 } 
      });
      
      const minResult = safeParseWithContext(schema, { level: -5 }, null);
      expect(minResult.success).toBe(true);
      expect(minResult.data?.level).toBe(1);
      
      const maxResult = safeParseWithContext(schema, { level: 100 }, null);
      expect(maxResult.success).toBe(true);
      expect(maxResult.data?.level).toBe(50);
    });

    it('should handle force type conversion then clamp', () => {
      const schema = compileSchema({ 
        HP: { $type: 'number(force)', $min: 0, $max: 100 } 
      });
      
      const result = safeParseWithContext(schema, { HP: '150' }, null);
      expect(result.success).toBe(true);
      expect(result.data?.HP).toBe(100); // 字符串转数字后截断
    });

    it('should preserve values within range', () => {
      const schema = compileSchema({ 
        HP: { $type: 'number', $min: 0, $max: 100 } 
      });
      
      const result = safeParseWithContext(schema, { HP: 50 }, null);
      expect(result.success).toBe(true);
      expect(result.data?.HP).toBe(50); // 范围内值保持不变
    });
  });

  describe('Dynamic Clamping with refer()', () => {
    it('should clamp based on refer() constraint', () => {
      const schema = compileSchema({
        HP: { $type: 'number', $max: 'refer(HPMax)' },
        HPMax: { $type: 'number' }
      });

      const data = { HP: 150, HPMax: 100 };
      const ctx = mockContext(data);
      const result = safeParseWithContext(schema, data, ctx);
      
      expect(result.success).toBe(true);
      expect(result.data?.HP).toBe(100); // 截断到 refer(HPMax) 值
    });

    it('should skip clamping when refer() value is invalid', () => {
      const schema = compileSchema({
        HP: { $type: 'number', $max: 'refer(InvalidPath)' }
      });

      const result = safeParseWithContext(schema, { HP: 150 }, mockContext());
      expect(result.success).toBe(true);
      expect(result.data?.HP).toBe(150); // 引用无效时跳过截断
    });
  });

  describe('Non-Number Type Compatibility', () => {
    it('should not clamp string length constraints', () => {
      const schema = compileSchema({ 
        name: { $type: 'string', $maxLength: 5 } 
      });
      
      const result = safeParseWithContext(schema, { name: 'toolongname' }, null);
      expect(result.success).toBe(false); // 字符串长度约束仍然失败
    });

    it('should not clamp array item constraints', () => {
      const schema = compileSchema({ 
        items: { $type: 'array<string>', $maxItems: 2 } 
      });
      
      const result = safeParseWithContext(schema, { items: ['a', 'b', 'c'] }, null);
      expect(result.success).toBe(false); // 数组长度约束仍然失败
    });
  });

  describe('Edge Cases', () => {
    it('should handle equal min and max values', () => {
      const schema = compileSchema({ 
        fixed: { $type: 'number', $min: 42, $max: 42 } 
      });
      
      const result = safeParseWithContext(schema, { fixed: 100 }, null);
      expect(result.success).toBe(true);
      expect(result.data?.fixed).toBe(42); // 任何值都截断到固定值
    });

    it('should handle NaN and Infinity gracefully', () => {
      const schema = compileSchema({ 
        HP: { $type: 'number', $min: 0, $max: 100 } 
      });
      
      // NaN 会被 Zod 的 number 类型校验拦截
      const nanResult = safeParseWithContext(schema, { HP: NaN }, null);
      expect(nanResult.success).toBe(false); // NaN 不是有效的数字
      
      // Infinity 不被截断（因为 !isFinite 检查）
      const infResult = safeParseWithContext(schema, { HP: Infinity }, null);
      expect(infResult.success).toBe(true);
      expect(infResult.data?.HP).toBe(Infinity); // Infinity 不被截断
    });
  });
});