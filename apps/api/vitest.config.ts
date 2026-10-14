import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import path from 'node:path';

export default defineConfig({
  // SWC emits decorator metadata so NestJS DI resolves constructor params.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@estateflow/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
