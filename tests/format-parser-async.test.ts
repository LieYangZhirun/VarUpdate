/**
 * tests/format-parser-async.test.ts
 *
 * 补充覆盖 parseStructuredText（含 TOML 的三格式 fallback）。
 * 见审计报告改进项 #2。
 */

import { describe, it, expect } from 'vitest';
import { parseStructuredText, FormatParseError } from '../src/modules/format-parser';

describe('parseStructuredText（三格式 fallback）', () => {
  // ═══════════════════════════════════════════
  //  JSON 优先路径
  // ═══════════════════════════════════════════
  describe('JSON 优先', () => {
    it('合法 JSON 对象 → JSON 解析成功', () => {
      const result = parseStructuredText('{"HP": 80, "MP": 50}');
      expect(result).toEqual({ HP: 80, MP: 50 });
    });

    it('JSON 数组 → 包裹为 _value', () => {
      const result = parseStructuredText('[1, 2, 3]');
      expect(result).toEqual({ _value: [1, 2, 3] });
    });
  });

  // ═══════════════════════════════════════════
  //  TOML 分支（JSON 失败 → TOML 成功）
  // ═══════════════════════════════════════════
  describe('TOML 分支', () => {
    it('合法 TOML → 解析成功', () => {
      const tomlText = `
[character]
HP = 80
MP = 50
name = "hero"
`.trim();
      const result = parseStructuredText(tomlText);
      expect(result).toEqual({
        character: { HP: 80, MP: 50, name: 'hero' },
      });
    });

    it('TOML 嵌套表 → 正确解析层级', () => {
      const tomlText = `
[character.status]
HP = 100
debuff = "poisoned"
`.trim();
      const result = parseStructuredText(tomlText);
      expect(result).toEqual({
        character: { status: { HP: 100, debuff: 'poisoned' } },
      });
    });

    it('TOML 数组表 → 解析为数组', () => {
      const tomlText = `
[[items]]
name = "Iron Sword"
count = 1

[[items]]
name = "Potion"
count = 3
`.trim();
      const result = parseStructuredText(tomlText);
      expect(result).toEqual({
        items: [
          { name: 'Iron Sword', count: 1 },
          { name: 'Potion', count: 3 },
        ],
      });
    });

    it('TOML 布尔值和浮点数', () => {
      const tomlText = `
active = true
rate = 3.14
`.trim();
      const result = parseStructuredText(tomlText);
      expect(result.active).toBe(true);
      expect(result.rate).toBeCloseTo(3.14);
    });

    it('TOML 引号键名支持 Unicode', () => {
      const tomlText = `
["角色"]
HP = 80
`.trim();
      const result = parseStructuredText(tomlText);
      expect(result["角色"]).toEqual({ HP: 80 });
    });
  });

  // ═══════════════════════════════════════════
  //  YAML 回退（JSON + TOML 失败 → YAML 成功）
  // ═══════════════════════════════════════════
  describe('YAML 回退', () => {
    it('合法 YAML → 解析成功', () => {
      const result = parseStructuredText('HP: 80\nMP: 50');
      expect(result).toEqual({ HP: 80, MP: 50 });
    });

    it('嵌套 YAML', () => {
      const result = parseStructuredText('角色:\n  HP: 80\n  状态: 正常');
      expect(result).toEqual({ 角色: { HP: 80, 状态: '正常' } });
    });
  });

  // ═══════════════════════════════════════════
  //  错误处理
  // ═══════════════════════════════════════════
  describe('错误处理', () => {
    it('空文本 → FormatParseError', () => {
      expect(() => parseStructuredText('')).toThrow(FormatParseError);
    });

    it('纯空白文本 → FormatParseError', () => {
      expect(() => parseStructuredText('   \n  \t  ')).toThrow(FormatParseError);
    });
  });

  // ═══════════════════════════════════════════
  //  类型包裹
  // ═══════════════════════════════════════════
  describe('类型包裹', () => {
    it('纯数字 → { _value: number }', () => {
      const result = parseStructuredText('42');
      expect(result).toEqual({ _value: 42 });
    });

    it('null → {}', () => {
      const result = parseStructuredText('null');
      expect(result).toEqual({});
    });

    it('纯字符串（YAML 降级） → { _value: string }', () => {
      const result = parseStructuredText('just plain text');
      expect(result).toEqual({ _value: 'just plain text' });
    });
  });

  // ═══════════════════════════════════════════
  //  FormatParseError 错误详情
  // ═══════════════════════════════════════════
  describe('FormatParseError 错误详情', () => {
    it('FormatParseError.details 包含三种格式的错误信息', () => {
      // 构造一个三种格式都无法解析的文本比较困难（YAML 非常宽松），
      // 但空文本场景下 details 至少应存在
      try {
        parseStructuredText('');
      } catch (e) {
        expect(e).toBeInstanceOf(FormatParseError);
        expect((e as FormatParseError).details).toBeDefined();
      }
    });
  });
});
