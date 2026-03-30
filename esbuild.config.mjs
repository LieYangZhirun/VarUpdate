import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.argv.includes('--dev');

build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/bundle.js',
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  sourcemap: isDev,
  minify: !isDev,
  legalComments: 'external',
}).then(() => {
  console.log(`VarUpdate build complete (${isDev ? 'dev' : 'prod'}): bundled ESM, no externals`);
}).catch(() => process.exit(1));
