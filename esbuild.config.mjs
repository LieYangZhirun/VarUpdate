import { build } from 'esbuild';

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
  external: [
    // iframe 全局提供的库
    'lodash',
    'zod',
    'jquery',
    'toastr',
    // CDN 加载的第三方库
    'klona',
    'smol-toml',
    'json5',
  ],
}).then(() => {
  console.log(`✅ VarUpdate build complete (${isDev ? 'dev' : 'prod'})`);
}).catch(() => process.exit(1));
