import { describe, it, expect } from 'vitest';
import { mergeDeepWithConflictCheck, MergeConflictError } from '../src/shared/merge-deep-conflict';

/**
 * Var_Initial 多条合并策略与世界书 Var_Schema 一致
 */
describe('Var_Initial 深度合并', () => {
  it('多条键不重叠 → 合并为一对象', () => {
    const a = { hp: 10, 角色: { name: 'A' } };
    const b = { mp: 5 };
    const out = mergeDeepWithConflictCheck(a, b);
    expect(out.hp).toBe(10);
    expect(out.mp).toBe(5);
    expect(out.角色.name).toBe('A');
  });

  it('同路径相同值 → 通过', () => {
    const a = { hp: 10 };
    const b = { hp: 10 };
    const out = mergeDeepWithConflictCheck(a, b);
    expect(out.hp).toBe(10);
  });

  it('同路径不同值 → MergeConflictError', () => {
    expect(() => mergeDeepWithConflictCheck({ hp: 10 }, { hp: 20 })).toThrow(MergeConflictError);
  });

  it('嵌套路径冲突 → 带 path', () => {
    let caught: unknown;
    try {
      mergeDeepWithConflictCheck({ 角色: { hp: 1 } }, { 角色: { hp: 2 } });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(MergeConflictError);
    expect((caught as MergeConflictError).path).toBe('角色/hp');
  });
});
