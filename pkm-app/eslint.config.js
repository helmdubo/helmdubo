import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  {
    // INV-5: all data access goes through StorageAdapter. Only the storage
    // layer itself (and unit tests, which build throwaway in-memory
    // connections) may touch sqlite directly.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/storage/**', 'src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@sqlite.org/sqlite-wasm',
              message: 'INV-5: import sqlite only inside src/storage; everything else goes through StorageAdapter/repositories.',
            },
          ],
        },
      ],
    },
  },
);
