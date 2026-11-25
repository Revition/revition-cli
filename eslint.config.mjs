// Lint baseline (T0.1.4) + the TypeScript rules for the CLI packages (T1.1.1).
// legacy/ is the CLI imported from the platform monorepo as-is (T0.1.3); it is linted again when it is ported into
// packages/ (T2.1.x), and its own eslint.config.mjs points at the monorepo's shared config, which does not exist here.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  {
    // packages/api-client/src/index.ts is generated (T1.1.5): its own --check gate guards it, not lint.
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'legacy/**', 'packages/api-client/src/index.ts'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly', setTimeout: 'readonly' },
    },
  },
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ['packages/**/*.ts', 'plugins/**/*.ts', 'e2e/**/*.ts'] })),
  {
    files: ['packages/**/*.ts', 'plugins/**/*.ts', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // T1.1.4: every sink passes through redact(); nothing writes to the console directly (the Io / LineRedactor does).
    files: ['packages/*/src/**/*.{ts,js,mjs}', 'plugins/*/src/**/*.{ts,js,mjs}'],
    rules: { 'no-console': 'error' },
  },
  {
    // T1.1.1: every command extends RevitionCommand (the manifest test proves the same at runtime).
    files: ['packages/*/src/commands/**/*.{ts,js}', 'plugins/*/src/commands/**/*.{ts,js}', 'packages/*/src/test-fixtures/fixture-plugin/commands/**/*.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "ClassDeclaration[superClass.name!='RevitionCommand']",
          message: 'Every command extends RevitionCommand (T1.1.1): no command does its own auth or rendering.',
        },
        {
          selector: 'ClassDeclaration:not([superClass])',
          message: 'Every command extends RevitionCommand (T1.1.1).',
        },
      ],
    },
  },
];
