import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['js/vendor/', 'js/wasm/', 'js-dev/', 'pkg/', 'node_modules/'] },
  {
    extends: [
      ...tseslint.configs.recommended,
    ],
    files: ['js/**/*.ts', 'js/**/*.tsx', 'tests/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'off',
    },
  }
);
