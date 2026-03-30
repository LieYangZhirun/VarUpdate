import { describe, it, expect } from 'vitest';
import { resolvePath } from '../src/modules/json-patch/path-resolver';

describe('path-resolver', () => {
  const data = {
    角色: {
      HP: 80,
      MP: 50,
      背包: [
        { 名称: '铁剑', 品质: '精良' },
        { 名称: '皮甲', 品质: '普通' },
      ],
      状态效果: {
        中毒: { 持续回合: 3 },
      },
    },
    敌人: {
      HP: 200,
      名称: '巨龙',
    },
  };

  describe('精确路径匹配', () => {
    it('完整正确路径 → 不修正', () => {
      const result = resolvePath('角色/HP', data, 'replace');
      expect(result).not.toHaveProperty('reason');
      if (!('reason' in result)) {
        expect(result.resolved).toBe('角色/HP');
        expect(result.corrected).toBe(false);
      }
    });
  });

  describe('反向路径解析', () => {
    it('唯一叶子键名 → 自动修正', () => {
      const result = resolvePath('MP', data, 'replace');
      expect(result).not.toHaveProperty('reason');
      if (!('reason' in result)) {
        expect(result.resolved).toBe('角色/MP');
        expect(result.corrected).toBe(true);
      }
    });

    it('歧义叶子键名 + 祖先消歧 → 正确路径', () => {
      // HP 同时存在于 角色/HP 和 敌人/HP
      const result = resolvePath('角色/HP', data, 'replace');
      expect(result).not.toHaveProperty('reason');
      if (!('reason' in result)) {
        expect(result.resolved).toBe('角色/HP');
      }
    });

    it('中间路径错误但叶子唯一 → 修正', () => {
      // 持续回合 只在 角色/状态效果/中毒/持续回合
      const result = resolvePath('中毒/持续回合', data, 'replace');
      expect(result).not.toHaveProperty('reason');
      if (!('reason' in result)) {
        expect(result.resolved).toBe('角色/状态效果/中毒/持续回合');
        expect(result.corrected).toBe(true);
      }
    });
  });

  describe('insert 新键', () => {
    it('不存在的路径 → insert 操作不报错', () => {
      const result = resolvePath('角色/新属性', data, 'insert');
      expect(result).not.toHaveProperty('reason');
      if (!('reason' in result)) {
        expect(result.resolved).toBe('角色/新属性');
      }
    });
  });

  describe('数组索引', () => {
    it('路径以数字结尾 → 正确解析', () => {
      const result = resolvePath('角色/背包/0', data, 'replace');
      expect(result).not.toHaveProperty('reason');
    });

    it('数组末尾追加 (- 语法)', () => {
      const result = resolvePath('角色/背包/-', data, 'insert');
      expect(result).not.toHaveProperty('reason');
    });
  });

  describe('不存在的路径', () => {
    it('不存在的叶子 + replace → 报错', () => {
      const result = resolvePath('完全不存在的键', data, 'replace');
      expect(result).toHaveProperty('reason');
    });
  });
});
