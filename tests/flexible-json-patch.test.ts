import { describe, it, expect } from 'vitest';
import { parseInstructions, PatchParseError } from '../src/modules/json-patch/flexible-json-patch';

describe('parseInstructions', () => {
  // ═══════════════════════════════════════════
  //  步骤 1：文本清洗
  // ═══════════════════════════════════════════
  describe('文本清洗', () => {
    it('去除 ```json / ``` 代码块标记', () => {
      const result = parseInstructions('```json\n[{"op":"replace","path":"HP","value":80}]\n```');
      expect(result.instructions).toHaveLength(1);
      expect(result.instructions[0].op).toBe('replace');
    });

    it('去除 BOM 标记', () => {
      const result = parseInstructions('\uFEFF[{"op":"replace","path":"HP","value":80}]');
      expect(result.instructions).toHaveLength(1);
    });

    it('去除前后自然语言文本', () => {
      const raw = '好的，以下是变量更新指令：\n[{"op":"replace","path":"HP","value":80}]\n希望这些修改符合您的需求。';
      const result = parseInstructions(raw);
      expect(result.instructions).toHaveLength(1);
      expect(result.instructions[0].path).toBe('HP');
    });

    it('单个指令对象（无数组包裹）', () => {
      const raw = '这是更新: {"op":"replace","path":"HP","value":80} 结束';
      const result = parseInstructions(raw);
      expect(result.instructions).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════
  //  步骤 2：引号修正
  // ═══════════════════════════════════════════
  describe('引号修正', () => {
    it('值内未转义双引号 → 自动补转义', () => {
      // "进化日" 内的引号导致解析问题
      const raw = '[{"op":"replace","path":"事件","value":"今天是进化日"}]';
      const result = parseInstructions(raw);
      expect(result.instructions).toHaveLength(1);
      expect(result.instructions[0].value).toBe('今天是进化日');
    });

    it('正常 JSON 不被修改', () => {
      const raw = '[{"op":"replace","path":"HP","value":80}]';
      const result = parseInstructions(raw);
      expect(result.instructions).toHaveLength(1);
      expect(result.instructions[0].value).toBe(80);
    });
  });

  // ═══════════════════════════════════════════
  //  步骤 3：宽松 JSON 解析
  // ═══════════════════════════════════════════
  describe('宽松 JSON 解析', () => {
    it('尾逗号 → 通过', () => {
      const result = parseInstructions('[{"op":"replace","path":"HP","value":80},]');
      expect(result.instructions).toHaveLength(1);
    });

    it('无引号键名 → 通过', () => {
      const result = parseInstructions('[{op:"replace",path:"HP",value:80}]');
      expect(result.instructions).toHaveLength(1);
    });

    it('单引号字符串 → 通过', () => {
      const result = parseInstructions("[{'op':'replace','path':'HP','value':80}]");
      expect(result.instructions).toHaveLength(1);
    });

    it('注释 → 忽略', () => {
      const result = parseInstructions(`[
        // 更新HP
        {"op":"replace","path":"HP","value":80}
      ]`);
      expect(result.instructions).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════
  //  步骤 4：语义规范化
  // ═══════════════════════════════════════════
  describe('语义规范化', () => {
    it('"add" → "insert"', () => {
      const result = parseInstructions('[{"op":"add","path":"新字段","value":1}]');
      expect(result.instructions[0].op).toBe('insert');
    });

    it('"remove" → "delete"', () => {
      const result = parseInstructions('[{"op":"remove","path":"旧字段"}]');
      expect(result.instructions[0].op).toBe('delete');
    });

    it('"set" → "replace"', () => {
      const result = parseInstructions('[{"op":"set","path":"HP","value":80}]');
      expect(result.instructions[0].op).toBe('replace');
    });

    it('op 大小写不敏感', () => {
      const result = parseInstructions('[{"op":"REPLACE","path":"HP","value":80}]');
      expect(result.instructions[0].op).toBe('replace');
    });

    it('缺少 op → 丢弃该条', () => {
      const result = parseInstructions('[{"path":"HP","value":80}]');
      expect(result.instructions).toHaveLength(0);
      expect(result.discarded).toHaveLength(1);
      expect(result.discarded[0].reason).toContain('缺少 op');
    });

    it('replace 缺少 value → 丢弃', () => {
      const result = parseInstructions('[{"op":"replace","path":"HP"}]');
      expect(result.instructions).toHaveLength(0);
      expect(result.discarded).toHaveLength(1);
    });

    it('delete 不需要 value → 保留', () => {
      const result = parseInstructions('[{"op":"delete","path":"废弃字段"}]');
      expect(result.instructions).toHaveLength(1);
      expect(result.instructions[0].op).toBe('delete');
    });

    it('路径规范化：去除前导 /', () => {
      const result = parseInstructions('[{"op":"replace","path":"/角色/HP","value":80}]');
      expect(result.instructions[0].path).toBe('角色/HP');
    });
  });

  // ═══════════════════════════════════════════
  //  综合场景
  // ═══════════════════════════════════════════
  describe('综合', () => {
    it('AI 典型输出（代码块 + 前后文字 + 尾逗号）', () => {
      const raw = `好的，我来更新变量：

\`\`\`json
[
  {"op": "replace", "path": "角色/HP", "value": 75},
  {"op": "insert", "path": "状态效果/中毒", "value": {"持续回合": 3}},
  {"op": "delete", "path": "临时标记"},
]
\`\`\`

以上是本轮的变量更新。`;

      const result = parseInstructions(raw);
      expect(result.instructions).toHaveLength(3);
      expect(result.instructions[0]).toEqual({ op: 'replace', path: '角色/HP', value: 75 });
      expect(result.instructions[1]).toEqual({ op: 'insert', path: '状态效果/中毒', value: { '持续回合': 3 } });
      expect(result.instructions[2]).toEqual({ op: 'delete', path: '临时标记' });
    });

    it('混合合法和非法指令', () => {
      const raw = `[
        {"op": "replace", "path": "HP", "value": 80},
        {"invalid": true},
        {"op": "unknown_op", "path": "x", "value": 1},
        {"op": "delete", "path": "old"}
      ]`;
      const result = parseInstructions(raw);
      expect(result.instructions).toHaveLength(2);
      expect(result.discarded).toHaveLength(2);
    });

    it('完全无法解析的文本 → PatchParseError', () => {
      expect(() => parseInstructions('这完全不是JSON')).toThrow(PatchParseError);
    });

    it('空数组 → 空结果', () => {
      const result = parseInstructions('[]');
      expect(result.instructions).toHaveLength(0);
      expect(result.discarded).toHaveLength(0);
    });

    it('value 字段名兼容（Value / val）', () => {
      const r1 = parseInstructions('[{"op":"replace","path":"HP","Value":80}]');
      expect(r1.instructions[0].value).toBe(80);

      const r2 = parseInstructions('[{"op":"replace","path":"HP","val":80}]');
      expect(r2.instructions[0].value).toBe(80);
    });
  });
});
