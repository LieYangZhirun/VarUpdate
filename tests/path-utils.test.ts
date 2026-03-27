import { describe, it, expect } from 'vitest';
import { parsePath, getValueByPath, setValueByPath, deleteByPath, findAllPaths } from '../src/shared/path-utils';

describe('parsePath', () => {
  it('标准路径', () => {
    expect(parsePath('角色/HP')).toEqual(['角色', 'HP']);
  });
  it('数组索引', () => {
    expect(parsePath('背包/0/名称')).toEqual(['背包', '0', '名称']);
  });
  it('空路径 → []', () => {
    expect(parsePath('')).toEqual([]);
  });
  it('单段路径', () => {
    expect(parsePath('HP')).toEqual(['HP']);
  });
  it('去除首尾 /', () => {
    expect(parsePath('/角色/HP/')).toEqual(['角色', 'HP']);
  });
});

describe('getValueByPath', () => {
  const data = { 角色: { HP: 80, 背包: [{ 名称: '铁剑' }, { 名称: '皮甲' }] } };

  it('嵌套取值', () => {
    expect(getValueByPath(data, '角色/HP')).toBe(80);
  });
  it('数组索引取值', () => {
    expect(getValueByPath(data, '角色/背包/0/名称')).toBe('铁剑');
  });
  it('不存在的路径 → undefined', () => {
    expect(getValueByPath(data, '角色/MP')).toBeUndefined();
  });
  it('空路径 → 返回根对象', () => {
    expect(getValueByPath(data, '')).toBe(data);
  });
});

describe('setValueByPath', () => {
  it('设置已有路径的值', () => {
    const data = { 角色: { HP: 80 } };
    setValueByPath(data, '角色/HP', 100);
    expect(data.角色.HP).toBe(100);
  });
  it('自动创建中间节点', () => {
    const data: any = {};
    setValueByPath(data, '角色/状态/中毒', true);
    expect(data.角色.状态.中毒).toBe(true);
  });
  it('数组追加 (- 语法)', () => {
    const data = { 背包: ['铁剑'] };
    setValueByPath(data, '背包/-', '皮甲');
    expect(data.背包).toEqual(['铁剑', '皮甲']);
  });
});

describe('deleteByPath', () => {
  it('删除已有键', () => {
    const data = { 角色: { HP: 80, MP: 50 } };
    expect(deleteByPath(data, '角色/MP')).toBe(true);
    expect(data.角色).toEqual({ HP: 80 });
  });
  it('删除数组元素', () => {
    const data = { 背包: ['铁剑', '皮甲'] };
    expect(deleteByPath(data, '背包/0')).toBe(true);
    expect(data.背包).toEqual(['皮甲']);
  });
  it('不存在的路径 → false', () => {
    expect(deleteByPath({ a: 1 }, 'b')).toBe(false);
  });
});

describe('findAllPaths', () => {
  it('搜索叶子键名', () => {
    const data = {
      角色: { HP: 80, 状态效果: { 中毒: { 持续回合: 3 } } },
      敌人: { 状态效果: { 灼烧: { 持续回合: 5 } } },
    };
    const results = findAllPaths(data, '持续回合');
    expect(results).toHaveLength(2);
    expect(results).toContain('角色/状态效果/中毒/持续回合');
    expect(results).toContain('敌人/状态效果/灼烧/持续回合');
  });
  it('不存在的键 → []', () => {
    expect(findAllPaths({ a: 1 }, 'b')).toEqual([]);
  });
});
