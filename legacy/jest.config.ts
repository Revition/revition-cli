import type { Config } from 'jest';

/** Transpile-only, as in apps/api: `tsc --noEmit` (the package's `type-check`) is the type gate. */
const config: Config = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  globalSetup: '<rootDir>/../../scripts/jest-ci-lock.js',
  maxWorkers: 2,
  forceExit: true,
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { isolatedModules: true } }],
  },
};

export default config;
