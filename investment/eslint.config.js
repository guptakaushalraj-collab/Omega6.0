import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'database/data/**'],
  },

  js.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'object-shorthand': 'error',
    },
  },

  // Browser code: React, JSX, and no Node globals.
  {
    files: ['frontend/src/**/*.{js,jsx}', 'tests/frontend/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      // Prop-types add noise without type safety; this project relies on the
      // shapes the offline layer already guarantees.
      'react/prop-types': 'off',
    },
  },

  // The service worker has its own globals and is not a module.
  {
    files: ['frontend/public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker }, sourceType: 'script' },
  },

  {
    files: ['tests/**/*.{js,jsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
  },
];
