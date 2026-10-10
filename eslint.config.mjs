// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { project: './tsconfig.check.json', tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  {
    // On stdio, stdout carries the protocol. One stray line there breaks the
    // connection, so nothing in the server may write to it. Log through
    // src/logger.ts, which writes to stderr.
    files: ['src/**/*.ts'],
    ignores: ['src/example/api/**'],
    rules: {
      'no-console': 'error',
      'no-restricted-properties': ['error', { object: 'process', property: 'stdout', message: 'stdout is the protocol channel. Use the logger (stderr).' }],
    },
  },
  {
    // Vitest types its asymmetric matchers (expect.stringContaining and friends) as `any`.
    files: ['test/**/*.ts'],
    rules: { '@typescript-eslint/no-unsafe-assignment': 'off' },
  },
  { files: ['eslint.config.mjs'], extends: [tseslint.configs.disableTypeChecked] },
);
