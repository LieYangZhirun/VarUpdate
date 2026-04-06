import { describe, it, expect } from 'vitest';
import {
  fillDefaultsForValue,
  getDefaultValue,
  isFieldOptional,
} from '../src/shared/schema-defaults';

describe('schema-defaults', () => {
  // ═══════════════════════════════════════════
  //  辅助函数
  // ═══════════════════════════════════════════
  describe('辅助函数', () => {
    it('getDefaultValue 读取 $default', () => {
      expect(getDefaultValue({ $type: 'number', $default: 42 })).toBe(42);
      expect(getDefaultValue({ $type: 'string' })).toBeUndefined();
      expect(getDefaultValue(null)).toBeUndefined();
    });

    it('isFieldOptional 判断 $optional', () => {
      expect(isFieldOptional({ $type: 'string', $optional: true })).toBe(true);
      expect(isFieldOptional({ $type: 'string' })).toBe(false);
      expect(isFieldOptional(null)).toBeFalsy();
    });
  });

  // ═══════════════════════════════════════════
  //  fillDefaultsForValue — insert 模式
  // ═══════════════════════════════════════════
  describe('fillDefaultsForValue — insert 模式', () => {
    const schema = {
      HP: { $type: 'number', $default: 100 },
      MP: { $type: 'number' },
      昵称: { $type: 'string', $optional: true, $default: '无名' },
      标记: { $type: 'boolean', $optional: true },
    };

    it('填充所有有 $default 的缺失字段（含 optional）', () => {
      const result = fillDefaultsForValue({}, schema, schema, { mode: 'insert' });
      expect(result.HP).toBe(100);     // $default
      expect(result.昵称).toBe('无名');  // $optional + $default → 仍填充
      expect(result.MP).toBeNull();     // 无 $default + 非可选 → null
    });

    it('optional 无 $default 不填', () => {
      const result = fillDefaultsForValue({}, schema, schema, { mode: 'insert' });
      expect(Object.prototype.hasOwnProperty.call(result, '标记')).toBe(false);
    });

    it('已有值不覆盖', () => {
      const result = fillDefaultsForValue({ HP: 50 }, schema, schema, { mode: 'insert' });
      expect(result.HP).toBe(50);
    });
  });

  // ═══════════════════════════════════════════
  //  fillDefaultsForValue — replace 模式
  // ═══════════════════════════════════════════
  describe('fillDefaultsForValue — replace 模式', () => {
    const schema = {
      HP: { $type: 'number', $default: 100 },
      MP: { $type: 'number' },
      昵称: { $type: 'string', $optional: true, $default: '无名' },
      标记: { $type: 'boolean', $optional: true },
    };

    it('从旧值恢复缺失的非可选字段', () => {
      const result = fillDefaultsForValue(
        {},
        schema,
        schema,
        { mode: 'replace', oldValue: { HP: 80, MP: 30 } },
      );
      expect(result.HP).toBe(80);
      expect(result.MP).toBe(30);
    });

    it('旧值中也没有 → 用 $default', () => {
      const result = fillDefaultsForValue(
        {},
        schema,
        schema,
        { mode: 'replace', oldValue: {} },
      );
      expect(result.HP).toBe(100);  // $default 兜底
      expect(result.MP).toBeNull(); // 无 $default → null
    });

    it('可选字段无旧值不填', () => {
      const result = fillDefaultsForValue(
        {},
        schema,
        schema,
        { mode: 'replace', oldValue: {} },
      );
      expect(Object.prototype.hasOwnProperty.call(result, '昵称')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(result, '标记')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════
  //  fillDefaultsForValue — $defs 结构体递归
  // ═══════════════════════════════════════════
  describe('fillDefaultsForValue — $defs 递归', () => {
    const schema = {
      $defs: {
        物品: {
          $type: 'object',
          名称: { $type: 'string' },
          数量: { $type: 'number', $default: 1 },
          稀有度: { $type: 'string', $optional: true },
        },
      },
      背包: { $type: 'array<物品>' },
    };

    it('数组元素中缺失字段按 insert 模式补全', () => {
      const result = fillDefaultsForValue(
        { 背包: [{ 名称: '铁剑' }, { 名称: '盾牌', 数量: 5 }] },
        schema,
        schema,
        { mode: 'insert' },
      );
      expect(result.背包[0]).toEqual({ 名称: '铁剑', 数量: 1 }); // 数量补全
      expect(result.背包[1]).toEqual({ 名称: '盾牌', 数量: 5 }); // 已有不覆盖
      // 稀有度：$optional 无 $default → 不填
      expect(result.背包[0]).not.toHaveProperty('稀有度');
    });
  });

  // ═══════════════════════════════════════════
  //  fillDefaultsForValue — union 顺序匹配
  // ═══════════════════════════════════════════
  describe('fillDefaultsForValue — union 顺序匹配', () => {
    const schema = {
      $defs: {
        女主: {
          $type: 'object',
          基本信息: { $type: 'object', 名称: { $type: 'string' } },
          HP: { $type: 'number', $default: 100 },
          状态: { $type: 'string', $optional: true, $default: '正常' },
        },
        配角: {
          $type: 'object',
          $extensible: true,
          职能: { $type: 'string', $default: '未指定' },
          备注: { $type: 'string', $optional: true },
        },
        角色: { $type: ['女主', '配角'] },
      },
      角色列表: { $type: 'record<角色>' },
    };

    it('含配角独有字段 → 匹配配角、按配角填充', () => {
      const result = fillDefaultsForValue(
        { 职能: '管家' },
        schema.$defs.角色,  // $type: [女主, 配角]
        schema,
        { mode: 'insert' },
      );
      // 应按配角填充，不应出现女主的字段
      expect(result.职能).toBe('管家');
      expect(result).not.toHaveProperty('基本信息');
      expect(result).not.toHaveProperty('HP');
    });

    it('含女主声明字段 → 匹配女主、按女主填充', () => {
      const result = fillDefaultsForValue(
        { 基本信息: { 名称: '小红' } },
        schema.$defs.角色,
        schema,
        { mode: 'insert' },
      );
      // 应按女主填充
      expect(result.HP).toBe(100);
      expect(result.状态).toBe('正常');
      expect(result).not.toHaveProperty('职能');
    });

    it('全部未知字段 → 匹配首个 extensible 分支（配角）', () => {
      const result = fillDefaultsForValue(
        { 自定义: '随便' },
        schema.$defs.角色,
        schema,
        { mode: 'insert' },
      );
      // 女主不允许未知键 → 跳过；配角 extensible → 匹配
      expect(result.职能).toBe('未指定');  // 配角的 $default
      expect(result.自定义).toBe('随便');  // 保留原值
      expect(result).not.toHaveProperty('HP');
    });

    it('record 中不同值按各自类型填充', () => {
      const result = fillDefaultsForValue(
        {
          角色列表: {
            小红: { 基本信息: { 名称: '小红' } },
            管家: { 职能: '大管家' },
          },
        },
        schema,
        schema,
        { mode: 'insert' },
      );
      // 小红 → 女主
      expect(result.角色列表.小红.HP).toBe(100);
      expect(result.角色列表.小红).not.toHaveProperty('职能');
      // 管家 → 配角
      expect(result.角色列表.管家.职能).toBe('大管家');
      expect(result.角色列表.管家).not.toHaveProperty('HP');
    });
  });

  // ═══════════════════════════════════════════
  //  fillDefaultsForValue — 父 $default 级联
  // ═══════════════════════════════════════════
  describe('fillDefaultsForValue — 父 $default 级联', () => {
    it('父 $default 级联到无 $default 的子字段', () => {
      const schema = {
        $type: 'object',
        $default: { HP: 100, MP: 50, 状态: '正常' },
        HP: { $type: 'number' },
        MP: { $type: 'number' },
        状态: { $type: 'string' },
      };
      const result = fillDefaultsForValue({}, schema, schema, { mode: 'insert' });
      expect(result.HP).toBe(100);    // 从父 $default 获取
      expect(result.MP).toBe(50);     // 从父 $default 获取
      expect(result.状态).toBe('正常'); // 从父 $default 获取
    });

    it('父 $default 优先于子字段自身 $default', () => {
      const schema = {
        $type: 'object',
        $default: { HP: 100, MP: 50 },
        HP: { $type: 'number', $default: 999 },
        MP: { $type: 'number' },
      };
      const result = fillDefaultsForValue({}, schema, schema, { mode: 'insert' });
      expect(result.HP).toBe(100);   // 父 $default 优先
      expect(result.MP).toBe(50);    // 无子 $default，用父 $default
    });

    it('已有值不被父 $default 覆盖', () => {
      const schema = {
        $type: 'object',
        $default: { HP: 100, MP: 50 },
        HP: { $type: 'number' },
        MP: { $type: 'number' },
      };
      const result = fillDefaultsForValue({ HP: 80 }, schema, schema, { mode: 'insert' });
      expect(result.HP).toBe(80);    // 已有值保留
      expect(result.MP).toBe(50);    // 缺失字段从父 $default 获取
    });

    it('replace 模式下优先级：旧值 > 父 $default > 子 $default', () => {
      const schema = {
        $type: 'object',
        $default: { HP: 100, MP: 50, SP: 30 },
        HP: { $type: 'number', $default: 999 },
        MP: { $type: 'number' },
        SP: { $type: 'number' },
      };
      const result = fillDefaultsForValue(
        {},
        schema,
        schema,
        { mode: 'replace', oldValue: { MP: 80 } },
      );
      expect(result.HP).toBe(100);   // 父 $default 优先于子 $default
      expect(result.MP).toBe(80);    // 旧值恢复
      expect(result.SP).toBe(30);    // 父 $default
    });

    it('可选字段：无子/父 $default 时不填', () => {
      const schema = {
        $type: 'object',
        $default: { HP: 100 },  // 不含"标记"
        HP: { $type: 'number' },
        标记: { $type: 'boolean', $optional: true },
      };
      const result = fillDefaultsForValue({}, schema, schema, { mode: 'insert' });
      expect(result.HP).toBe(100);
      expect(result).not.toHaveProperty('标记');  // 可选 + 无任何 default → 不填
    });

    it('可选字段：有父 $default 时填充', () => {
      const schema = {
        $type: 'object',
        $default: { 标记: true },
        标记: { $type: 'boolean', $optional: true },
      };
      const result = fillDefaultsForValue({}, schema, schema, { mode: 'insert' });
      expect(result.标记).toBe(true);  // 有父 $default → 填充
    });
  });

  // ═══════════════════════════════════════════
  //  fillDefaultsForValue — 容器类型零值推断
  // ═══════════════════════════════════════════
  describe('fillDefaultsForValue — 容器类型零值推断', () => {
    it('record 无 $default → 填充 {}', () => {
      const schema = {
        $defs: {
          建筑: {
            $type: 'object',
            描述: { $type: 'string', $default: '{{建筑描述}}' },
          },
        },
        城市地图: { $type: 'record<建筑>' },
      };
      const result = fillDefaultsForValue({}, schema, schema, { mode: 'insert' });
      expect(result.城市地图).toEqual({});
    });

    it('array 无 $default → 填充 []', () => {
      const schema = {
        技能列表: { $type: 'array<string>' },
      };
      const result = fillDefaultsForValue({}, schema, schema, { mode: 'insert' });
      expect(result.技能列表).toEqual([]);
    });

    it('object 无 $default → 填充 {} 并递归补全子字段', () => {
      const schema = {
        记忆系统: {
          $type: 'object',
          日记: { $type: 'record<string>' },
          周志: { $type: 'record<string>' },
        },
      };
      const result = fillDefaultsForValue({}, schema, schema, { mode: 'insert' });
      expect(result.记忆系统).toEqual({ 日记: {}, 周志: {} });
    });

    it('$defs 引用类型缺失 → 填充 {} 并递归补全子字段', () => {
      const schema = {
        $defs: {
          状态: {
            $type: 'object',
            HP: { $type: 'number', $default: 100 },
            MP: { $type: 'number', $default: 50 },
          },
        },
        角色状态: { $type: '状态' },
      };
      const result = fillDefaultsForValue({}, schema, schema, { mode: 'insert' });
      expect(result.角色状态).toEqual({ HP: 100, MP: 50 });
    });

    it('replace 模式：record 无旧值无 $default → 填充 {}', () => {
      const schema = {
        势力: { $type: 'record<string>' },
      };
      const result = fillDefaultsForValue(
        {},
        schema,
        schema,
        { mode: 'replace', oldValue: {} },
      );
      expect(result.势力).toEqual({});
    });

    it('原始类型无 $default → 仍为 null', () => {
      const schema = {
        计数: { $type: 'number' },
      };
      const result = fillDefaultsForValue({}, schema, schema, { mode: 'insert' });
      expect(result.计数).toBeNull();
    });
  });

  // ═══════════════════════════════════════════
  //  fillDefaultsForValue — $key_rule.$default 模板条目
  // ═══════════════════════════════════════════
  describe('fillDefaultsForValue — $key_rule.$default 模板条目', () => {
    it('record 有 $key_rule.$default → 生成模板条目并填充结构体默认值', () => {
      const schema = {
        $defs: {
          角色: {
            $type: 'object',
            HP: { $type: 'number', $default: 100 },
            状态: { $type: 'string', $default: '正常' },
          },
        },
        红颜知己: {
          $type: 'record<角色>',
          $key_rule: { $default: '{{角色名}}' },
        },
      };
      const result = fillDefaultsForValue({}, schema, schema, { mode: 'insert' });
      expect(result.红颜知己).toEqual({
        '{{角色名}}': { HP: 100, 状态: '正常' },
      });
    });

    it('record 有 $key_rule.$default 但已有值 → 不覆盖', () => {
      const schema = {
        $defs: {
          角色: {
            $type: 'object',
            HP: { $type: 'number', $default: 100 },
          },
        },
        红颜知己: {
          $type: 'record<角色>',
          $key_rule: { $default: '{{角色名}}' },
        },
      };
      const input = { 红颜知己: { 小红: { HP: 80 } } };
      const result = fillDefaultsForValue(input, schema, schema, { mode: 'insert' });
      expect(result.红颜知己).toEqual({ 小红: { HP: 80 } });
    });

    it('$key_rule.$default 的值为空字符串 → 视为无模板，填充 {}', () => {
      const schema = {
        列表: {
          $type: 'record<string>',
          $key_rule: { $default: '' },
        },
      };
      const result = fillDefaultsForValue({}, schema, schema, { mode: 'insert' });
      expect(result.列表).toEqual({});
    });

    it('嵌套：object 内含 record + $key_rule.$default', () => {
      const schema = {
        $defs: {
          记忆条目: {
            $type: 'object',
            内容: { $type: 'string', $default: '{{记录内容}}' },
          },
        },
        记忆系统: {
          $type: 'object',
          日记: {
            $type: 'record<记忆条目>',
            $key_rule: {
              $enum: ['第***日'],
              $default: '{{第X日}}',
            },
          },
          周志: {
            $type: 'record<记忆条目>',
            $key_rule: {
              $enum: ['第***周'],
            },
          },
        },
      };
      const result = fillDefaultsForValue({}, schema, schema, { mode: 'insert' });
      // 日记有 $key_rule.$default → 模板条目
      expect(result.记忆系统.日记).toEqual({
        '{{第X日}}': { 内容: '{{记录内容}}' },
      });
      // 周志无 $key_rule.$default → 空字典
      expect(result.记忆系统.周志).toEqual({});
    });
  });
});
