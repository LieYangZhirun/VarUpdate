import { describe, it, expect } from 'vitest';
import { sanitizeMessageIndexForWrite } from '../src/shared/message-index';

describe('sanitizeMessageIndexForWrite', () => {
  it('接受非负整数', () => {
    expect(sanitizeMessageIndexForWrite(0)).toBe(0);
    expect(sanitizeMessageIndexForWrite(12)).toBe(12);
  });

  it('undefined / null → undefined', () => {
    expect(sanitizeMessageIndexForWrite(undefined)).toBeUndefined();
    expect(sanitizeMessageIndexForWrite(null)).toBeUndefined();
  });

  it('拒绝负数、非整数、NaN、Infinity', () => {
    expect(sanitizeMessageIndexForWrite(-1)).toBeUndefined();
    expect(sanitizeMessageIndexForWrite(1.5)).toBeUndefined();
    expect(sanitizeMessageIndexForWrite(NaN)).toBeUndefined();
    expect(sanitizeMessageIndexForWrite(Infinity)).toBeUndefined();
  });

  it('数字字符串经 parseInt', () => {
    expect(sanitizeMessageIndexForWrite('0')).toBe(0);
    expect(sanitizeMessageIndexForWrite('  3  ')).toBe(3);
    expect(sanitizeMessageIndexForWrite('10')).toBe(10);
  });

  it('小数点字符串按 parseInt 截断为整数', () => {
    expect(sanitizeMessageIndexForWrite('1.2')).toBe(1);
  });

  it('非法字符串 → undefined', () => {
    expect(sanitizeMessageIndexForWrite('')).toBeUndefined();
    expect(sanitizeMessageIndexForWrite('abc')).toBeUndefined();
  });

  it('非 number/string（对象、数组、布尔等）→ undefined', () => {
    expect(sanitizeMessageIndexForWrite({})).toBeUndefined();
    expect(sanitizeMessageIndexForWrite([])).toBeUndefined();
    expect(sanitizeMessageIndexForWrite(true)).toBeUndefined();
  });
});
