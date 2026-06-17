import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/vitest-setup.ts', '@testing-library/jest-dom/vitest'],
    include: ['tests/**/*.test.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['core/**/*.ts', 'catalog/**/*.ts', 'query/**/*.ts', 'report/**/*.ts', 'ui/**/*.ts', 'ui/**/*.tsx'],
    },
  },
});
