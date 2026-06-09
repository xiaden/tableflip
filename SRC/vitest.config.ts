import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/vitest-setup.ts'],
    include: ['tests/**/*.test.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['js/**/*.ts', 'js/**/*.tsx'],
      exclude: ['js/vendor/**', 'js/wasm/**', 'js/types/**'],
    },
  },
});
