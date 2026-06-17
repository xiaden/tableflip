import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['preact/tests/vitest-setup.ts'],
    include: ['preact/tests/**/*.test.ts', 'preact/tests/**/*.test.tsx'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['preact/**/*.ts', 'preact/**/*.tsx'],
    },
  },
});
