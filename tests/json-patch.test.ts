import { describe, it, expect } from 'vitest';
import { executeUpdate, executeUpdateSync } from '../src/modules/json-patch/index';
import { compileSchemaFromData, bindSafeParseWithContext } from '../src/modules/schema-compiler/index';
import { getValueByPath } from '../src/shared/path-utils';
import { getSchemaNodeForPath } from '../src/modules/json-patch/patch-value-fill';
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

  describe('executeUpdate（含预处理层）', () => {
    it('预处理丢弃与有效指令混合时 discarded 计入丢弃数', () => {
      const data = { 角色: { HP: 80 } };
      const raw = `[
    "bad",
    { "op": "replace", "path": "/角色/HP", "value": 99 }
  ]`;
      const result = executeUpdate(raw, data);
      expect(result.appliedCount).toBe(1);
      expect(result.data.角色.HP).toBe(99);
      expect(result.discarded.length).toBeGreaterThanOrEqual(1);
      expect(result.discarded.some(d => d.reason.includes('非对象'))).toBe(true);
    });

    it('外层 ``` 围栏 + value 内 PromptalYAML 式 ``` 原样写入', () => {
      const data = { 角色: { 背景: '' } };
      const inner = '```\n第一章\n```';
      const raw =
        '```json\n[{"op":"replace","path":"/角色/背景","value":' +
        JSON.stringify(inner) +
        '}]\n```';
      const result = executeUpdate(raw, data);
      expect(result.appliedCount).toBe(1);
      expect(result.data.角色.背景).toBe(inner);
    });
  });

  describe('Patch 写入值按 Schema 补全缺失子键', () => {
    it('replace 缺失子键：从旧值恢复 → $default → null；$optional 不添加', () => {
      const schemaData = {
        $defs: {
          子: {
            $type: 'object',
            必填无默认: { $type: 'any' },
            可跳过: { $type: 'string', $optional: true },
            有默认: { $type: 'string', $default: '缺省Z' },
          },
        },
        根: {
          实体: {
            $type: 'object',
            嵌套: { $type: '子' },
          },
        },
      };
      const schema = compileSchemaFromData(schemaData);
      const data = { 根: { 实体: { 嵌套: { 必填无默认: 1, 有默认: '旧' } } } };
      const bound = bindSafeParseWithContext(schema, {
        resolveRef: (p: string) => getValueByPath(data, p),
      });
      const result = executeUpdateSync(
        [{ op: 'replace', path: '根/实体/嵌套', value: {} }],
        data,
        schema,
        bound,
      );
      expect(result.appliedCount).toBe(1);
      // replace 模式：缺失字段从旧值恢复
      expect(result.data.根.实体.嵌套).toEqual({
        必填无默认: 1,  // 从旧值恢复
        有默认: '旧',   // 从旧值恢复
      });
      expect(Object.prototype.hasOwnProperty.call(result.data.根.实体.嵌套, '可跳过')).toBe(false);
    });

    it('嵌套 object 内层缺键递归补全', () => {
      const schemaData = {
        $defs: {
          内层: {
            $type: 'object',
            leaf: { $type: 'string', $default: 'L' },
          },
        },
        根: {
          $type: 'object',
          外层: {
            $type: 'object',
            inner: { $type: '内层' },
          },
        },
      };
      const schema = compileSchemaFromData(schemaData);
      const data = { 根: { 外层: { inner: { leaf: 'x' } } } };
      const bound = bindSafeParseWithContext(schema, {
        resolveRef: (p: string) => getValueByPath(data, p),
      });
      const result = executeUpdateSync(
        [{ op: 'replace', path: '根/外层', value: { inner: {} } }],
        data,
        schema,
        bound,
      );
      expect(result.appliedCount).toBe(1);
      // replace 模式：inner 的旧值 { leaf: 'x' } 被恢复
      expect(result.data.根.外层.inner).toEqual({ leaf: 'x' });
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

// ═══════════════════════════════════════════
//  getSchemaNodeForPath — $defs / union 穿透
// ═══════════════════════════════════════════

describe('getSchemaNodeForPath — 路径穿透', () => {
  const schema = {
    $defs: {
      女主: {
        $type: 'object',
        基本信息: { $type: 'object', 名称: { $type: 'string' } },
        HP: { $type: 'number' },
      },
      配角: {
        $type: 'object',
        $extensible: true,
        职能: { $type: 'string' },
      },
      角色: { $type: ['女主', '配角'] },
      地点: {
        $type: 'object',
        描述: { $type: 'string' },
      },
    },
    角色列表: { $type: 'record<角色>' },
    城市地图: { $type: 'record<地点>' },
    主角: {
      $type: '女主',
    },
  };

  it('穿透 $defs 引用：主角/HP', () => {
    const node = getSchemaNodeForPath(schema, '主角/HP');
    expect(node).toBeTruthy();
    expect(node.$type).toBe('number');
  });

  it('穿透 $defs 引用的嵌套：主角/基本信息/名称', () => {
    const node = getSchemaNodeForPath(schema, '主角/基本信息/名称');
    expect(node).toBeTruthy();
    expect(node.$type).toBe('string');
  });

  it('穿透 record + $defs：城市地图/公园/描述', () => {
    const node = getSchemaNodeForPath(schema, '城市地图/公园/描述');
    expect(node).toBeTruthy();
    expect(node.$type).toBe('string');
  });

  it('穿透 record + union：角色列表/某角色/HP（女主分支）', () => {
    const node = getSchemaNodeForPath(schema, '角色列表/某角色/HP');
    expect(node).toBeTruthy();
    expect(node.$type).toBe('number');
  });

  it('穿透 record + union：角色列表/某角色/职能（配角分支）', () => {
    const node = getSchemaNodeForPath(schema, '角色列表/某角色/职能');
    expect(node).toBeTruthy();
    expect(node.$type).toBe('string');
  });

  it('不存在的路径返回 null', () => {
    expect(getSchemaNodeForPath(schema, '角色列表/某角色/不存在字段')).toBeNull();
  });
});
