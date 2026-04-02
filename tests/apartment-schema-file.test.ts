import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { compileSchema } from '../src/modules/schema-compiler/schema-to-zod.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APARTMENT_SCHEMA = path.join(
  __dirname,
  '..',
  '..',
  '公寓管理员[VarUpdate测试项目]',
  '[Var_Schema]变量格式规则(源文本).yml',
);

const hasApartmentFixture = fs.existsSync(APARTMENT_SCHEMA);

describe('公寓 Schema 源文件', () => {
  it.skipIf(!hasApartmentFixture)('应能被 compileSchema 编译（依赖多轮 $defs）', () => {
    const raw = fs.readFileSync(APARTMENT_SCHEMA, 'utf8');
    const data = yaml.load(raw) as Record<string, unknown>;
    expect(() => compileSchema(data)).not.toThrow();
  });
});
