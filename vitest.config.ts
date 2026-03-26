import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vendorRoot = path.join(__dirname, 'vendor');

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: true,
  },
  resolve: {
    alias: {
      '@': './src',
      '@vendor/promptal-yaml': path.join(vendorRoot, 'promptal-yaml/src/index.ts'),
      '@vendor/schema-to-zod': path.join(vendorRoot, 'schema-to-zod/src/index.ts'),
      '@vendor/flexible-json-patch': path.join(vendorRoot, 'flexible-json-patch/src/index.ts'),
    },
  },
});
