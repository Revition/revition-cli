import baseConfig from '@revition/config/eslint/base.mjs';

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  {
    // Tests are not production source: no return-type strictness (the same rule apps/api applies to its tests).
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'jest.config.ts'],
  },
];
