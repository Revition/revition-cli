// Lint baseline (T0.1.4). The TypeScript rules arrive with the CLI packages (T1.1.1).
// legacy/ is the CLI imported from the platform monorepo as-is (T0.1.3); it is linted again when it is ported into
// packages/ (T2.1.x), and its own eslint.config.mjs points at the monorepo's shared config, which does not exist here.
import js from '@eslint/js';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'legacy/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
  },
];
