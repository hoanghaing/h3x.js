import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: { index: 'src/index.ts', 'core/index': 'src/core/index.ts' },
      formats: ['es'],
    },
    rollupOptions: { external: ['nanoid'] },
  },
  plugins: [dts({ include: ['src'] })],
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
