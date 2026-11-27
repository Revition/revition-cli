import assert from 'node:assert/strict';
import { test } from 'node:test';

import { suitesFor, workspaceConcurrency } from './test-all.mjs';

test('[CLI-T1.4.2-AC1] the package suites run one at a time on Windows (child-spawning suites starved the runner), four elsewhere', () => {
  assert.equal(workspaceConcurrency('win32'), 1);
  assert.equal(workspaceConcurrency('linux'), 4);
  assert.equal(workspaceConcurrency('darwin'), 4);
  assert.match(suitesFor('win32'), /pnpm -r --workspace-concurrency=1 --if-present run test$/);
  assert.match(suitesFor('linux'), /pnpm -r --workspace-concurrency=4 --if-present run test$/);
  // The other suites are unchanged.
  assert.match(suitesFor('linux'), /^node --test "scripts\/\*\.test\.mjs" && node --import tsx --test "legacy-parity\/\*\.test\.mjs" && /);
});
