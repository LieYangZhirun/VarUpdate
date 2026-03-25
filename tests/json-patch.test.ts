import { describe, it, expect } from 'vitest';
import { executeUpdateSync } from '../src/modules/json-patch/index';
import type { PatchInstruction } from '../src/types/index';

describe('json-patch 引擎', () => {
  describe('replace 操作', () => {
    it('替换已有值', () => {
      const data = { 角色: { HP: 80, MP: 50 } };
      const instructions: PatchInstruction[] = [
        { op: 'replace', path: '角色/HP', value: 100 },
      ];
      const result = executeUpdateSync(instructions, data);
      expect(result.appliedCount).toBe(1);
      expect(result.data.角色.HP).toBe(100);
      expect(result.log['角色/HP']).toContain('80');
      expect(result.log['角色/HP']).toContain('100');
    });

    it('替换不存在的路径 → 丢弃', () => {
      const data = { HP: 80 };
      const instructions: PatchInstruction[] = [
        { op: 'replace', path: '不存在', value: 99 },
      ];
      const result = executeUpdateSync(instructions, data);
      expect(result.appliedCount).toBe(0);
      expect(result.discarded).toHaveLength(1);
    });
  });

  describe('insert 操作', () => {
    it('插入新键', () => {
      const data = { 角色: { HP: 80 } };
      const instructions: PatchInstruction[] = [
        { op: 'insert', path: '角色/MP', value: 50 },
      ];
      const result = executeUpdateSync(instructions, data);
      expect(result.appliedCount).toBe(1);
      expect(result.data.角色.MP).toBe(50);
    });

    it('已存在的键 insert → 丢弃 (不覆盖)', () => {
      const data = { 角色: { HP: 80 } };
      const instructions: PatchInstruction[] = [
        { op: 'insert', path: '角色/HP', value: 100 },
      ];
      const result = executeUpdateSync(instructions, data);
      expect(result.appliedCount).toBe(0);
      expect(result.data.角色.HP).toBe(80); // 未被覆盖
    });
  });

  describe('delete 操作', () => {
    it('删除已有键', () => {
      const data = { 角色: { HP: 80, MP: 50 } };
      const instructions: PatchInstruction[] = [
        { op: 'delete', path: '角色/MP' },
      ];
      const result = executeUpdateSync(instructions, data);
      expect(result.appliedCount).toBe(1);
      expect(result.data.角色.MP).toBeUndefined();
    });
  });

  describe('反向路径解析集成', () => {
    it('唯一叶子键名自动修正', () => {
      const data = { 角色: { HP: 80, MP: 50 } };
      const instructions: PatchInstruction[] = [
        { op: 'replace', path: 'MP', value: 100 },
      ];
      const result = executeUpdateSync(instructions, data);
      expect(result.appliedCount).toBe(1);
      expect(result.data.角色.MP).toBe(100);
    });
  });

  describe('同路径去重', () => {
    it('同路径多指令 → 保留最后一条', () => {
      const data = { HP: 50 };
      const instructions: PatchInstruction[] = [
        { op: 'replace', path: 'HP', value: 60 },
        { op: 'replace', path: 'HP', value: 80 },
        { op: 'replace', path: 'HP', value: 100 },
      ];
      const result = executeUpdateSync(instructions, data);
      expect(result.appliedCount).toBe(1);
      expect(result.data.HP).toBe(100);
    });
  });

  describe('混合操作', () => {
    it('多种操作混合执行', () => {
      const data = {
        角色: { HP: 80, 名称: '勇者' },
        背包: ['铁剑'],
      };
      const instructions: PatchInstruction[] = [
        { op: 'replace', path: '角色/HP', value: 100 },
        { op: 'insert', path: '角色/MP', value: 50 },
        { op: 'delete', path: '角色/名称' },
      ];
      const result = executeUpdateSync(instructions, data);
      expect(result.appliedCount).toBe(3);
      expect(result.data.角色.HP).toBe(100);
      expect(result.data.角色.MP).toBe(50);
      expect(result.data.角色.名称).toBeUndefined();
    });
  });
});
