import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: 'src/index.ts',
        'core/index': 'src/core/index.ts',
        'three/index': 'src/three/index.ts',
        'plan/index': 'src/plan/index.ts',
      },
      formats: ['es'],
    },
    rollupOptions: { external: ['nanoid', 'three', /^three\//] },
  },
  plugins: [dts({ include: ['src'] })],
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
