/**
 * condition-evaluator.test.ts
 *
 * 模块 10：条件求值引擎的单元测试
 * 覆盖面向用户功能卡 L-3 ~ L-14 全部运算符与边界情况
 */

import { describe, it, expect } from 'vitest';
import { evaluateCondition, evaluateAllConditions } from '../src/modules/condition-evaluator.js';

// ═══════════════════════════════════════════
//  L-3 基本比较运算符
// ═══════════════════════════════════════════

describe('基本比较运算符', () => {
  const data = { 地点: '酒馆', HP: 100, 好感度: 75, flag: true, empty: null };

  // ── 宽松相等 ==  ──
  describe('== 宽松相等', () => {
    it('字符串相等', () => {
      expect(evaluateCondition('"地点" == "酒馆"', data)).toBe(true);
    });
    it('字符串不等', () => {
      expect(evaluateCondition('"地点" == "旅店"', data)).toBe(false);
    });
    it('数字相等', () => {
      expect(evaluateCondition('"HP" == 100', data)).toBe(true);
    });
    it('字符串与数字宽松比较', () => {
      const d = { val: '100' };
      expect(evaluateCondition('"val" == 100', d)).toBe(true);
    });
    it('布尔值', () => {
      expect(evaluateCondition('"flag" == true', data)).toBe(true);
    });
    it('null', () => {
      expect(evaluateCondition('"empty" == null', data)).toBe(true);
    });
  });

  // ── 宽松不等 != ──
  describe('!= 宽松不等', () => {
    it('不等成立', () => {
      expect(evaluateCondition('"地点" != "旅店"', data)).toBe(true);
    });
    it('不等不成立', () => {
      expect(evaluateCondition('"地点" != "酒馆"', data)).toBe(false);
    });
  });

  // ── 严格相等 === ──
  describe('=== 严格相等', () => {
    it('类型和值都匹配', () => {
      expect(evaluateCondition('"HP" === 100', data)).toBe(true);
    });
    it('类型不匹配', () => {
      const d = { val: '100' };
      expect(evaluateCondition('"val" === 100', d)).toBe(false);
    });
  });

  // ── 严格不等 !== ──
  describe('!== 严格不等', () => {
    it('类型不同 → true', () => {
      const d = { val: '100' };
      expect(evaluateCondition('"val" !== 100', d)).toBe(true);
    });
    it('完全相同 → false', () => {
      expect(evaluateCondition('"HP" !== 100', data)).toBe(false);
    });
  });

  // ── 数值比较 ──
  describe('数值比较 > >= < <=', () => {
    it('> 成立', () => {
      expect(evaluateCondition('"好感度" > 0', data)).toBe(true);
    });
    it('> 不成立', () => {
      expect(evaluateCondition('"好感度" > 100', data)).toBe(false);
    });
    it('>= 边界', () => {
      expect(evaluateCondition('"好感度" >= 75', data)).toBe(true);
    });
    it('< 成立', () => {
      expect(evaluateCondition('"好感度" < 80', data)).toBe(true);
    });
    it('<= 边界', () => {
      expect(evaluateCondition('"好感度" <= 75', data)).toBe(true);
    });
    it('非数字比较 → false', () => {
      expect(evaluateCondition('"地点" > 10', data)).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════
//  L-5 存在性检查
// ═══════════════════════════════════════════

describe('存在性检查', () => {
  const data = { 圣杯: '持有', empty: null };

  it('? 变量存在 → true', () => {
    expect(evaluateCondition('"圣杯" ?', data)).toBe(true);
  });
  it('? 变量不存在 → false', () => {
    expect(evaluateCondition('"不存在的变量" ?', data)).toBe(false);
  });
  it('? null → false', () => {
    expect(evaluateCondition('"empty" ?', data)).toBe(false);
  });
  it('!? 变量不存在 → true', () => {
    expect(evaluateCondition('"不存在的变量" !?', data)).toBe(true);
  });
  it('!? 变量存在 → false', () => {
    expect(evaluateCondition('"圣杯" !?', data)).toBe(false);
  });
});

// ═══════════════════════════════════════════
//  L-4 通配符匹配
// ═══════════════════════════════════════════

describe('通配符匹配', () => {
  const data = { 心情: '很开心啊', 地点: '社会民主主义' };

  it('*** 任意位置包含', () => {
    expect(evaluateCondition('"心情" == "***开心***"', data)).toBe(true);
  });
  it('*** 以结尾', () => {
    expect(evaluateCondition('"心情" == "***心啊"', data)).toBe(true);
  });
  it('*** 不匹配', () => {
    expect(evaluateCondition('"心情" == "***难过***"', data)).toBe(false);
  });
  it('** 前面恰好 2 字符', () => {
    // "社会民主主义" = 6 字符，"**民主主义" = 2(恰好1字符×2) + 4("民主主义") = 6 → 匹配
    expect(evaluateCondition('"地点" == "**民主主义"', data)).toBe(true);
  });
});

// ═══════════════════════════════════════════
//  L-6 嵌套属性访问
// ═══════════════════════════════════════════

describe('嵌套属性访问', () => {
  const data = {
    角色: { 状态: { HP: 80 }, 装备: { 武器: '圣剑' } },
    世界: { 天气: '暴风雨' },
  };

  it('深层数值比较', () => {
    expect(evaluateCondition('"角色/状态/HP" >= 60', data)).toBe(true);
  });
  it('深层字符串比较', () => {
    expect(evaluateCondition('"角色/装备/武器" == "圣剑"', data)).toBe(true);
  });
  it('路径不存在 → false（静默）', () => {
    expect(evaluateCondition('"角色/不存在/属性" >= 0', data)).toBe(false);
  });
});

// ═══════════════════════════════════════════
//  L-7 数组操作
// ═══════════════════════════════════════════

describe('数组操作', () => {
  const data = { 物品栏: ['圣杯', '短剑', '火焰魔法书', '治疗药水'] };

  it('∋ 数组含值', () => {
    expect(evaluateCondition('"物品栏" ∋ "圣杯"', data)).toBe(true);
  });
  it('∋ 数组不含值 → false', () => {
    expect(evaluateCondition('"物品栏" ∋ "圣盾"', data)).toBe(false);
  });
  it('!∋ 数组不含值', () => {
    expect(evaluateCondition('"物品栏" !∋ "圣盾"', data)).toBe(true);
  });
  it('∋ 通配符匹配', () => {
    expect(evaluateCondition('"物品栏" ∋ "***魔法书"', data)).toBe(true);
  });
  it('∋ 非数组 → false', () => {
    const d = { val: '字符串' };
    expect(evaluateCondition('"val" ∋ "字"', d)).toBe(false);
  });
});

// ═══════════════════════════════════════════
//  L-8 对象/字典操作
// ═══════════════════════════════════════════

describe('对象/字典操作', () => {
  const data = { 属性: { 力量: 10, 敏捷: 8, 火焰元素魔法书: true } };

  it('⊇ 对象含键', () => {
    expect(evaluateCondition('"属性" ⊇ "力量"', data)).toBe(true);
  });
  it('⊇ 对象不含键 → false', () => {
    expect(evaluateCondition('"属性" ⊇ "智力"', data)).toBe(false);
  });
  it('!⊇ 对象不含键', () => {
    expect(evaluateCondition('"属性" !⊇ "智力"', data)).toBe(true);
  });
  it('⊇ 通配符匹配键名', () => {
    expect(evaluateCondition('"属性" ⊇ "***元素魔法书"', data)).toBe(true);
  });
});

// ═══════════════════════════════════════════
//  L-9 集合长度判断
// ═══════════════════════════════════════════

describe('集合长度判断', () => {
  const data = { 物品栏: ['剑', '盾', '药水'], 属性: { 力量: 10, 敏捷: 8 } };

  it('# >= 数组长度', () => {
    expect(evaluateCondition('"物品栏" # >= 3', data)).toBe(true);
  });
  it('# == 数组长度', () => {
    expect(evaluateCondition('"物品栏" # == 3', data)).toBe(true);
  });
  it('# === 数组长度', () => {
    expect(evaluateCondition('"物品栏" # === 3', data)).toBe(true);
  });
  it('# !== 数组长度', () => {
    expect(evaluateCondition('"物品栏" # !== 2', data)).toBe(true);
  });
  it('# > 0 非空判断', () => {
    expect(evaluateCondition('"物品栏" # > 0', data)).toBe(true);
  });
  it('# 对象键数', () => {
    expect(evaluateCondition('"属性" # == 2', data)).toBe(true);
  });
  it('# 非集合 → false', () => {
    const d = { val: 42 };
    expect(evaluateCondition('"val" # > 0', d)).toBe(false);
  });
});

// ═══════════════════════════════════════════
//  L-10 变量与变量比较
// ═══════════════════════════════════════════

describe('变量与变量比较', () => {
  const data = { 当前HP: 50, 最大HP: 100, 地点: '酒馆', 目标地点: '酒馆', 敌人: { 防御力: 30 }, 攻击力: 45 };

  it('<= 变量引用', () => {
    expect(evaluateCondition('"当前HP" <= $"最大HP"', data)).toBe(true);
  });
  it('== 变量引用', () => {
    expect(evaluateCondition('"地点" == $"目标地点"', data)).toBe(true);
  });
  it('> 嵌套路径变量引用', () => {
    expect(evaluateCondition('"攻击力" > $"敌人/防御力"', data)).toBe(true);
  });
});

// ═══════════════════════════════════════════
//  L-2 逻辑组合
// ═══════════════════════════════════════════

describe('逻辑组合', () => {
  const data = { 地点: '酒馆', HP: 80, MP: 30 };

  it('| OR：任一满足 → true', () => {
    expect(evaluateCondition('"地点" == "酒馆"|"地点" == "旅店"', data)).toBe(true);
  });
  it('| OR：全部不满足 → false', () => {
    expect(evaluateCondition('"地点" == "战场"|"地点" == "深渊"', data)).toBe(false);
  });
  it('! NOT：条件取反', () => {
    expect(evaluateCondition('!"地点" == "虚空"', data)).toBe(true);
  });
  it('! NOT：原本为真取反为假', () => {
    expect(evaluateCondition('!"地点" == "酒馆"', data)).toBe(false);
  });
});

// ═══════════════════════════════════════════
//  evaluateAllConditions 集成
// ═══════════════════════════════════════════

describe('evaluateAllConditions', () => {
  const data = { HP: 80, MP: 30, 地点: '酒馆' };

  it('多标签 AND 全部通过', () => {
    expect(evaluateAllConditions('["HP" >= 60]["MP" > 0] 战斗设定', data)).toBe(true);
  });
  it('多标签 AND 一个不通过 → false', () => {
    expect(evaluateAllConditions('["HP" >= 60]["MP" > 50] 战斗设定', data)).toBe(false);
  });
  it('无标签 → true（不过滤）', () => {
    expect(evaluateAllConditions('普通文本，没有标签', data)).toBe(true);
  });
  it('混合 AND + OR', () => {
    expect(evaluateAllConditions(
      '["HP" >= 60]["地点" == "酒馆"|"地点" == "旅店"] 标签',
      data,
    )).toBe(true);
  });
  it('综合：NOT + AND + OR（L-2 综合示例）', () => {
    const d = { HP: 80, MP: 10, 地点: '森林' };
    expect(evaluateAllConditions(
      '["HP" >= 60]["MP" > 0][!"地点" == "虚空"|!"地点" == "深渊"]',
      d,
    )).toBe(true);
  });
});

// ═══════════════════════════════════════════
//  边界与错误处理（L-13）
// ═══════════════════════════════════════════

describe('边界与错误处理', () => {
  it('空表达式 → false', () => {
    expect(evaluateCondition('', {})).toBe(false);
  });
  it('语法错误（缺运算符） → false', () => {
    expect(evaluateCondition('"HP"', { HP: 100 })).toBe(false);
  });
  it('引号不配对 → false', () => {
    expect(evaluateCondition('"HP >= 60', { HP: 100 })).toBe(false);
  });
  it('变量数据为 null → false', () => {
    expect(evaluateCondition('"HP" >= 60', null as any)).toBe(false);
  });
  it('变量数据为 undefined → false', () => {
    expect(evaluateCondition('"HP" >= 60', undefined as any)).toBe(false);
  });
  it('单 OR 分支失败不影响其他', () => {
    // 第一个分支语法错误，第二个分支有效
    expect(evaluateCondition('broken|"HP" == 100', { HP: 100 })).toBe(true);
  });
  it('evaluateAllConditions：解析错误的标签 → false', () => {
    expect(evaluateAllConditions('[broken syntax] 文本', { HP: 100 })).toBe(false);
  });
  it('转义括号不提取', () => {
    expect(evaluateAllConditions('\\["HP" >= 60] 文本', { HP: 100 })).toBe(true);
  });
  it('反引号内括号不提取', () => {
    expect(evaluateAllConditions('`["HP" >= 60]` 文本', { HP: 100 })).toBe(true);
  });
});
