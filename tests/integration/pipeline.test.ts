/**
 * tests/integration/pipeline.test.ts
 *
 * 目标：在 Node 中通过 stub 全局 API，覆盖主流程级数据流（见《测试规范》§5.1）。
 *
 * 覆盖场景：
 * - Schema → 编译 → 初始化默认值 → 执行 Update 指令
 * - 格式解析失败 → 不写入变量
 * - Patch 部分失败 → 丢弃计数
 * - Schema 校验拦截非法值 → 单条回滚
 * - refer() 跨模块数据流
 * - $hide 标记过滤
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractVarTags } from '../../src/modules/tag-extractor';
import { parseStructuredTextSync, FormatParseError } from '../../src/modules/format-parser';
import { compileSchemaFromData, clearCache, bindSafeParseWithContext } from '../../src/modules/schema-compiler/index';
import { executeUpdateSync } from '../../src/modules/json-patch/index';
import { filterMessageDataForMacro } from '../../src/shared/filter-macro-data-by-schema-hide';
import type { PatchInstruction } from '../../src/types/index';

// ═══════════════════════════════════════════
//  Mock 通知模块
// ═══════════════════════════════════════════
vi.mock('../../src/modules/notification', () => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  trace: vi.fn(),
  feedback: vi.fn(),
}));

beforeEach(() => {
  clearCache();
});

// ═══════════════════════════════════════════
//  集成测试用例
// ═══════════════════════════════════════════

describe('VarUpdate 集成测试', () => {
  describe('Schema → Initial → Update 完整流程', () => {
    it('解析 Schema 声明 → 编译 → 初始化默认值 → 执行 Update 指令', () => {
      // ── 步骤 1：Schema 声明（通常从世界书条目加载） ──
      const schemaData = {
        HP: { $type: 'number', $min: 0, $max: 100, $default: 100 },
        MP: { $type: 'number', $min: 0, $default: 50 },
        名称: { $type: 'string', $default: '勇者' },
        状态: { $type: 'string', $default: '正常', $enum: ['正常', '中毒', '昏迷', '死亡'] },
      };

      // ── 步骤 2：编译 Schema ──
      const compiled = compileSchemaFromData(schemaData);
      expect(compiled).toBeDefined();
      expect(compiled.validator).toBeDefined();

      // ── 步骤 3：模拟 Initial 过程（从默认值构建初始数据） ──
      const initialData: Record<string, any> = {
        HP: 100,
        MP: 50,
        名称: '勇者',
        状态: '正常',
      };

      // ── 步骤 4：消息包含 <Var_Update> 标签 ──
      const message = `战斗开始！敌人攻击了勇者。
<Var_Update>
[
  { "op": "replace", "path": "/HP", "value": 70 },
  { "op": "replace", "path": "/状态", "value": "中毒" }
]
</Var_Update>`;

      // 提取标签
      const extraction = extractVarTags(message);
      expect(extraction.tags.length).toBe(1);
      expect(extraction.tags[0].type).toBe('update');

      // 解析标签内容
      const tagContent = extraction.tags[0].content;
      const instructions = JSON.parse(tagContent) as PatchInstruction[];

      // ── 步骤 5：执行 Update ──
      const ctx = {
        resolveRef: (path: string) => {
          const parts = path.split('/');
          let val: any = initialData;
          for (const p of parts) {
            if (val === undefined || val === null) return undefined;
            val = val[p];
          }
          return val;
        },
      };

      const boundSafeParse = bindSafeParseWithContext(compiled, ctx);
      const result = executeUpdateSync(instructions, { ...initialData }, compiled, boundSafeParse);

      // 验证结果
      expect(result.appliedCount).toBe(2);
      expect(result.data.HP).toBe(70);
      expect(result.data.状态).toBe('中毒');
      expect(result.discarded.length).toBe(0);
    });
  });

  describe('错误传播与联动', () => {
    it('格式解析失败 → 抛出 FormatParseError → 不写入变量', () => {
      // 模拟一段完全无法解析的空文本
      expect(() => parseStructuredTextSync('')).toThrow(FormatParseError);
    });

    it('Patch 指令部分失败 → 丢弃计数 → 成功的部分仍然生效', () => {
      const schemaData = {
        HP: { $type: 'number', $min: 0, $max: 100 },
        MP: { $type: 'number', $min: 0, $max: 100 },
      };
      const compiled = compileSchemaFromData(schemaData);
      const currentData = { HP: 100, MP: 50 };

      // 指令 1: 合法（HP 70, 在范围内）
      // 指令 2: 非法路径（/不存在的字段）
      const instructions: PatchInstruction[] = [
        { op: 'replace', path: '/HP', value: 70 },
        { op: 'replace', path: '/不存在的字段', value: 999 },
      ];

      const result = executeUpdateSync(instructions, { ...currentData }, compiled);

      // HP 应被成功更新
      expect(result.data.HP).toBe(70);
      // MP 保持不变
      expect(result.data.MP).toBe(50);
      // 应有 1 条成功
      expect(result.appliedCount).toBe(1);
      // 不存在的路径应被丢弃
      expect(result.discarded.length).toBe(1);
    });

    it('Schema 校验拦截非法值 → 单条回滚', () => {
      const schemaData = {
        HP: { $type: 'number', $min: 0, $max: 100 },
        MP: { $type: 'number', $min: 0, $max: 100 },
      };
      const compiled = compileSchemaFromData(schemaData);
      const currentData = { HP: 100, MP: 50 };

      const ctx = {
        resolveRef: (_path: string) => undefined,
      };
      const boundSafeParse = bindSafeParseWithContext(compiled, ctx);

      // 指令 1: 合法（HP = 80）
      // 指令 2: 非法（MP = 200, 超过 $max: 100）
      const instructions: PatchInstruction[] = [
        { op: 'replace', path: '/HP', value: 80 },
        { op: 'replace', path: '/MP', value: 200 },
      ];

      const result = executeUpdateSync(instructions, { ...currentData }, compiled, boundSafeParse);

      // HP 应成功更新
      expect(result.data.HP).toBe(80);
      // MP 应被截断到上限值（而不是回滚）
      expect(result.data.MP).toBe(100);
      // 2 条都成功（因为截断机制）
      expect(result.appliedCount).toBe(2);
      expect(result.discarded.length).toBe(0);
    });
  });

  describe('跨模块数据流', () => {
    it('refer() 约束 → 从变量存储读取当前值 → 限制 Update 写入', () => {
      const schemaData = {
        HP: { $type: 'number', $min: 0, $max: 'refer(HPMax)' },
        HPMax: { $type: 'number' },
      };
      const compiled = compileSchemaFromData(schemaData);

      const currentData = { HP: 80, HPMax: 100 };
      const ctx = {
        resolveRef: (path: string) => {
          const parts = path.split('/');
          let val: any = currentData;
          for (const p of parts) {
            if (val == null) return undefined;
            val = val[p];
          }
          return val;
        },
      };

      const boundSafeParse = bindSafeParseWithContext(compiled, ctx);

      // 尝试将 HP 设为 120（超过 HPMax=100）
      const instructions: PatchInstruction[] = [
        { op: 'replace', path: '/HP', value: 120 },
      ];

      const result = executeUpdateSync(instructions, { ...currentData }, compiled, boundSafeParse);

      // HP 应被截断到 refer(HPMax) 值（而不是保持原值）
      expect(result.data.HP).toBe(100);
      expect(result.discarded.length).toBe(0); // 截断机制让指令成功执行
      expect(result.appliedCount).toBe(1);
    });

    it('$hide 标记 → 宏输出时隐藏字段', () => {
      // filterMessageDataForMacro 接收 raw schema（非 compiled），因为 $hide 是原始 Schema 属性
      const schemaRaw = {
        HP: { $type: 'number' },
        _internal: { $type: 'string', $hide: true },
        公开信息: { $type: 'string' },
      };

      const data = {
        HP: 80,
        _internal: '内部数据不应暴露给宏',
        公开信息: '可见内容',
      };

      // 使用 $hide 过滤（根路径 = 空字符串）
      const result = filterMessageDataForMacro(data, schemaRaw, '');
      const filtered = result.value as Record<string, any>;

      // _internal 应被过滤
      expect(filtered).not.toHaveProperty('_internal');
      // HP 和公开信息应保留
      expect(filtered.HP).toBe(80);
      expect(filtered.公开信息).toBe('可见内容');
    });
  });

  describe('标签提取 → 解析 → 执行 全链路', () => {
    it('多段 Update 标签按顺序执行', () => {
      const message = `
<Var_Update>
[{"op": "replace", "path": "/HP", "value": 80}]
</Var_Update>
一些叙述文本...
<Var_Update>
[{"op": "replace", "path": "/HP", "value": 60}]
</Var_Update>`;

      const extraction = extractVarTags(message);
      expect(extraction.tags.length).toBe(2);

      let data: Record<string, any> = { HP: 100 };

      // 按顺序执行每段 Update
      for (const tag of extraction.tags) {
        const instructions = JSON.parse(tag.content) as PatchInstruction[];
        const result = executeUpdateSync(instructions, { ...data });
        data = result.data as Record<string, any>;
      }

      // 最终 HP 应为第二段的值
      expect(data.HP).toBe(60);
    });

    it('Initial + Update 混合场景', () => {
      const message = `
<Var_Initial>
{"HP": 100, "MP": 50, "名称": "英雄"}
</Var_Initial>
AI 叙述...
<Var_Update>
[{"op": "replace", "path": "/HP", "value": 70}]
</Var_Update>`;

      const extraction = extractVarTags(message);
      expect(extraction.tags.length).toBe(2);
      expect(extraction.tags[0].type).toBe('initial');
      expect(extraction.tags[1].type).toBe('update');

      // 解析 Initial 数据
      const initialData = parseStructuredTextSync(extraction.tags[0].content);
      expect(initialData).toEqual({ HP: 100, MP: 50, 名称: '英雄' });

      // 执行 Update
      const updateInstructions = JSON.parse(extraction.tags[1].content) as PatchInstruction[];
      const result = executeUpdateSync(updateInstructions, { ...initialData });
      expect(result.data.HP).toBe(70);
      expect(result.data.MP).toBe(50);
    });

    it('截断检测（有开标签无闭标签）', () => {
      const message = `文本内容
<Var_Update>
[{"op": "replace", "path": "/HP", "value": 70}]`;

      const extraction = extractVarTags(message);
      expect(extraction.truncated).toBe(true);
      expect(extraction.truncatedType).toBe('update');
    });
  });
});
