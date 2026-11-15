import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const src = (p: string): string => fileURLToPath(new URL(`../src/${p}`, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: {
      'h3x/core': src('core/index.ts'),
      'h3x/three': src('three/index.ts'),
    },
  },
});
