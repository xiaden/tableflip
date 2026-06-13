import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['preact/tests/vitest-setup.ts'],
    include: ['preact/tests/**/*.test.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['preact/**/*.ts', 'preact/**/*.tsx'],
    },
  },
});
