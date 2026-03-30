import { describe, it, expect } from 'vitest';
import { serializeToPromptalYAML } from '../src/shared/promptal-yaml';

describe('serializeToPromptalYAML', () => {
  // ═══════════════════════════════════════════
  //  基础类型
  // ═══════════════════════════════════════════
  describe('基础类型', () => {
    it('number → 数字字面量', () => {
      expect(serializeToPromptalYAML(80)).toBe('80');
      expect(serializeToPromptalYAML(3.14)).toBe('3.14');
      expect(serializeToPromptalYAML(0)).toBe('0');
      expect(serializeToPromptalYAML(-42)).toBe('-42');
    });

    it('string → 不加引号', () => {
      expect(serializeToPromptalYAML('正常')).toBe('正常');
      expect(serializeToPromptalYAML('hello world')).toBe('hello world');
    });

    it('boolean → true / false', () => {
      expect(serializeToPromptalYAML(true)).toBe('true');
      expect(serializeToPromptalYAML(false)).toBe('false');
    });

    it('null / undefined → 空字符串', () => {
      expect(serializeToPromptalYAML(null)).toBe('');
      expect(serializeToPromptalYAML(undefined)).toBe('');
    });
  });

  // ═══════════════════════════════════════════
  //  对象
  // ═══════════════════════════════════════════
  describe('对象', () => {
    it('空对象 → {}', () => {
      expect(serializeToPromptalYAML({})).toBe('{}');
    });

    it('扁平对象 → 键名: 值 格式', () => {
      const result = serializeToPromptalYAML({ HP: 80, MP: 50, 状态: '正常' });
      expect(result).toBe('HP: 80\nMP: 50\n状态: 正常');
    });

    it('嵌套对象 → 两空格缩进', () => {
      const result = serializeToPromptalYAML({
        角色: { HP: 80, 状态: '正常' },
      });
      expect(result).toBe('角色:\n  HP: 80\n  状态: 正常');
    });

    it('深层嵌套', () => {
      const result = serializeToPromptalYAML({
        a: { b: { c: 1 } },
      });
      expect(result).toBe('a:\n  b:\n    c: 1');
    });
  });

  // ═══════════════════════════════════════════
  //  数组
  // ═══════════════════════════════════════════
  describe('数组', () => {
    it('空数组 → []', () => {
      expect(serializeToPromptalYAML([])).toBe('[]');
    });

    it('基础类型数组 → 内联格式', () => {
      expect(serializeToPromptalYAML(['火球术', '冰冻术', '雷击'])).toBe('[火球术, 冰冻术, 雷击]');
    });

    it('数值数组 → 内联格式', () => {
      expect(serializeToPromptalYAML([1, 2, 3])).toBe('[1, 2, 3]');
    });

    it('混合基础类型数组 → 内联格式', () => {
      expect(serializeToPromptalYAML(['abc', 42, true])).toBe('[abc, 42, true]');
    });

    it('对象数组 → 展开格式', () => {
      const result = serializeToPromptalYAML([
        { 名称: '铁剑', 品质: '精良' },
        { 名称: '皮甲', 品质: '普通' },
      ]);
      expect(result).toBe(
        '- 名称: 铁剑\n  品质: 精良\n- 名称: 皮甲\n  品质: 普通'
      );
    });

    it('混合数组（基础+复合）→ 展开格式', () => {
      const result = serializeToPromptalYAML([
        'simple',
        { key: 'value' },
      ]);
      // 含复合类型 → 整个数组使用展开格式
      expect(result).toContain('- simple');
      expect(result).toContain('- key: value');
    });
  });

  // ═══════════════════════════════════════════
  //  多行字符串
  // ═══════════════════════════════════════════
  describe('多行字符串', () => {
    it('含 \\n 的字符串 → ``` 围栏包裹', () => {
      const result = serializeToPromptalYAML('第一行\n第二行\n第三行');
      expect(result).toContain('```');
      expect(result).toContain('第一行');
      expect(result).toContain('第二行');
      expect(result).toContain('第三行');
    });

    it('对象中的多行字符串字段', () => {
      const result = serializeToPromptalYAML({
        背景故事: '曾经是骑士团长，\n在战役中失去了右臂。',
      });
      expect(result).toContain('背景故事:');
      expect(result).toContain('```');
      expect(result).toContain('曾经是骑士团长，');
    });
  });

  // ═══════════════════════════════════════════
  //  缩进传递
  // ═══════════════════════════════════════════
  describe('缩进传递', () => {
    it('indentLevel 参数控制起始缩进', () => {
      const result = serializeToPromptalYAML({ HP: 80, 状态: '正常' }, 1);
      // indentLevel=1 → 每行前有两空格
      const lines = result.split('\n');
      expect(lines[0]).toBe('  HP: 80');
      expect(lines[1]).toBe('  状态: 正常');
    });
  });

  // ═══════════════════════════════════════════
  //  综合示例（文档中的完整示例）
  // ═══════════════════════════════════════════
  describe('综合', () => {
    it('功能卡 K-3 完整示例', () => {
      const data = {
        角色: {
          HP: 80,
          MP: 50,
          背景故事: '曾经是王国的骑士团长，\n在一次战役中失去了右臂，\n从此隐居山林。',
          技能列表: ['火球术', '冰冻术', '雷击'],
          装备: [
            { 名称: '铁剑', 品质: '精良' },
            { 名称: '皮甲', 品质: '普通' },
          ],
          状态: '正常',
        },
        背包容量: 20,
      };

      const result = serializeToPromptalYAML(data);

      // 验证关键结构
      expect(result).toContain('角色:');
      expect(result).toContain('  HP: 80');
      expect(result).toContain('  MP: 50');
      expect(result).toContain('  技能列表: [火球术, 冰冻术, 雷击]');
      expect(result).toContain('  状态: 正常');
      expect(result).toContain('背包容量: 20');
      expect(result).toContain('```');
      // 装备数组应使用展开格式
      expect(result).toContain('  - 名称: 铁剑');
      expect(result).toContain('    品质: 精良');
    });

    it('空集合混合', () => {
      const result = serializeToPromptalYAML({
        空数组: [],
        空对象: {},
        有值: 42,
      });
      expect(result).toContain('空数组: []');
      expect(result).toContain('空对象: {}');
      expect(result).toContain('有值: 42');
    });
  });
});
