import { describe, it, expect } from 'vitest';
import { extractVarTags } from '../src/modules/tag-extractor';

describe('extractVarTags', () => {
  describe('基础提取', () => {
    it('提取 <Var_Update> 标签', () => {
      const text = '前文<Var_Update>[{"op":"replace","path":"HP","value":80}]</Var_Update>后文';
      const result = extractVarTags(text);
      expect(result.tags).toHaveLength(1);
      expect(result.tags[0].type).toBe('update');
      expect(result.tags[0].content).toBe('[{"op":"replace","path":"HP","value":80}]');
      expect(result.truncated).toBe(false);
    });

    it('提取 <Var_Initial> 标签', () => {
      const text = '<Var_Initial>{"HP": 100}</Var_Initial>';
      const result = extractVarTags(text);
      expect(result.tags).toHaveLength(1);
      expect(result.tags[0].type).toBe('initial');
      expect(result.tags[0].content).toBe('{"HP": 100}');
    });

    it('同时提取 Initial 和 Update', () => {
      const text = '<Var_Initial>{"HP":100}</Var_Initial>故事内容<Var_Update>[{"op":"replace","path":"HP","value":80}]</Var_Update>';
      const result = extractVarTags(text);
      expect(result.tags).toHaveLength(2);
      expect(result.tags[0].type).toBe('initial');
      expect(result.tags[1].type).toBe('update');
    });

    it('无标签 → 空结果', () => {
      const result = extractVarTags('普通文本，没有标签');
      expect(result.tags).toHaveLength(0);
      expect(result.truncated).toBe(false);
    });

    it('空文本 → 空结果', () => {
      expect(extractVarTags('').tags).toHaveLength(0);
    });
  });

  describe('宽松标签名匹配', () => {
    it('<var_update> 全小写', () => {
      const result = extractVarTags('<var_update>data</var_update>');
      expect(result.tags).toHaveLength(1);
      expect(result.tags[0].type).toBe('update');
    });

    it('<VarUpdate> 驼峰无下划线', () => {
      const result = extractVarTags('<VarUpdate>data</VarUpdate>');
      expect(result.tags).toHaveLength(1);
    });

    it('<VariableUpdate> 未缩写', () => {
      const result = extractVarTags('<VariableUpdate>data</VariableUpdate>');
      expect(result.tags).toHaveLength(1);
    });

    it('开闭标签格式不同但均合法', () => {
      const result = extractVarTags('<Var_Update>data</varupdate>');
      expect(result.tags).toHaveLength(1);
    });
  });

  describe('截断检测', () => {
    it('有开标签无闭标签 → truncated', () => {
      const result = extractVarTags('<Var_Update>incomplete data...');
      expect(result.tags).toHaveLength(0);
      expect(result.truncated).toBe(true);
      expect(result.truncatedType).toBe('update');
    });
  });

  describe('转义', () => {
    it('反斜杠转义 → 不识别', () => {
      const result = extractVarTags('\\<Var_Update>data</Var_Update>');
      // 开标签被转义，无法形成完整标签对
      expect(result.tags).toHaveLength(0);
    });

    it('代码块内 → 不识别', () => {
      const result = extractVarTags('`<Var_Update>`data`</Var_Update>`');
      expect(result.tags).toHaveLength(0);
    });

    it('围栏代码块内 → 不识别', () => {
      const result = extractVarTags('```\n<Var_Update>data</Var_Update>\n```');
      expect(result.tags).toHaveLength(0);
    });
  });

  describe('多段标签', () => {
    it('同类型多段', () => {
      const text = '<Var_Update>data1</Var_Update>中间<Var_Update>data2</Var_Update>';
      const result = extractVarTags(text);
      expect(result.tags).toHaveLength(2);
      expect(result.tags[0].content).toBe('data1');
      expect(result.tags[1].content).toBe('data2');
    });
  });
});
