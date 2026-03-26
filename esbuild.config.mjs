import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.argv.includes('--dev');

/** 内嵌 vendor：仅 VarUpdate 目录即可构建，无需上级 MyProject 兄弟包 */
const vendorRoot = path.join(__dirname, 'vendor');

build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/bundle.js',
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  sourcemap: isDev,
  minify: !isDev,
  alias: {
    '@vendor/promptal-yaml': path.join(vendorRoot, 'promptal-yaml/src/index.ts'),
    '@vendor/schema-to-zod': path.join(vendorRoot, 'schema-to-zod/src/index.ts'),
    '@vendor/flexible-json-patch': path.join(vendorRoot, 'flexible-json-patch/src/index.ts'),
  },
}).then(() => {
  console.log(`✅ VarUpdate build complete (${isDev ? 'dev' : 'prod'}) — full bundle, no externals`);
}).catch(() => process.exit(1));
