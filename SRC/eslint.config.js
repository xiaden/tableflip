import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['js/vendor/', 'js/wasm/', 'pkg/', 'node_modules/'] },
  {
    extends: [
      ...tseslint.configs.recommended,
    ],
    files: ['preact/**/*.ts', 'preact/**/*.tsx'],
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
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  }
);
