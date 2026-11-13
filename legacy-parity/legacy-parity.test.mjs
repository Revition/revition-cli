// T0.1.3 AC4: each legacy command, against the mock API, issues byte-identical HTTP requests before (the platform
// monorepo's packages/revition-cli, recorded in recorded-requests.json) and after (legacy/ in this repository).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { runCli } from '../legacy/src/commands.ts';

import { runAllCommands } from './parity-harness.mjs';

const BEFORE = JSON.parse(readFileSync(new URL('./recorded-requests.json', import.meta.url), 'utf8'));
const AFTER = await runAllCommands(runCli);

for (const name of ['scaffold', 'build', 'test', 'deploy', 'eval']) {
  test(`legacy ${name}: same exit code and byte-identical requests as before the move`, () => {
    assert.ok(BEFORE[name], `no recording for ${name}`);
    assert.ok(BEFORE[name].requests.length > 0, `${name} recorded no request (vacuous)`);
    assert.equal(AFTER[name].exit, BEFORE[name].exit);
    assert.equal(JSON.stringify(AFTER[name].requests), JSON.stringify(BEFORE[name].requests));
  });
}
