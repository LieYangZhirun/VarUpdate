import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractVarTags } from '../src/modules/tag-extractor.js';
import { parseInstructions } from '../src/modules/json-patch/flexible-json-patch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplePath = path.join(__dirname, '../examples/update_example.txt');

describe('examples/update_example.txt', () => {
  const raw = readFileSync(examplePath, 'utf8');

  it('整段带外层 ```json 围栏时，标签在围栏内 → extractVarTags 应提取不到（与 G-1 一致）', () => {
    const ext = extractVarTags(raw);
    expect(ext.tags.length).toBe(0);
  });

  it('仅标签内正文（无外层围栏）时 parseInstructions 应成功', () => {
    const inner = raw.split('<Var_Update>')[1].split('</Var_Update>')[0].trim();
    const pr = parseInstructions(inner);
    expect(pr.instructions.length).toBe(10);
    expect(pr.discarded.length).toBe(0);
  });
});
