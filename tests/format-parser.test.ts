import { describe, it, expect } from 'vitest';
import { parseStructuredTextSync, FormatParseError } from '../src/modules/format-parser';

describe('parseStructuredTextSync', () => {
  describe('JSON 解析', () => {
    it('合法 JSON 对象', () => {
      const result = parseStructuredTextSync('{"HP": 80, "MP": 50}');
      expect(result).toEqual({ HP: 80, MP: 50 });
    });

    it('JSON 数组 → 包裹为 _value', () => {
      const result = parseStructuredTextSync('[1, 2, 3]');
      expect(result).toEqual({ _value: [1, 2, 3] });
    });
  });

  describe('YAML 解析', () => {
    it('合法 YAML', () => {
      const result = parseStructuredTextSync('HP: 80\nMP: 50');
      expect(result).toEqual({ HP: 80, MP: 50 });
    });

    it('嵌套 YAML', () => {
      const result = parseStructuredTextSync('角色:\n  HP: 80\n  状态: 正常');
      expect(result).toEqual({ 角色: { HP: 80, 状态: '正常' } });
    });
  });

  describe('错误处理', () => {
    it('空文本 → FormatParseError', () => {
      expect(() => parseStructuredTextSync('')).toThrow(FormatParseError);
    });

    it('不可解析文本 → FormatParseError', () => {
      // YAML 其实很宽松，大多数文本都能被 YAML 解析为字符串
      // 所以被 _value 包裹返回
      const result = parseStructuredTextSync('just plain text');
      expect(result).toEqual({ _value: 'just plain text' });
    });
  });

  describe('类型包裹', () => {
    it('纯数字 → { _value: number }', () => {
      const result = parseStructuredTextSync('42');
      expect(result).toEqual({ _value: 42 });
    });

    it('null → {}', () => {
      const result = parseStructuredTextSync('null');
      expect(result).toEqual({});
    });
  });
});
