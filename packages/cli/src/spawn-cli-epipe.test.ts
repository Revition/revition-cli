/**
 * The test runner's own CLI spawner (test-fixtures/spawn-cli.ts). PR #13 run, macOS Node 24: `config --help` exited
 * before runCli wrote its (empty) stdin, and the write failed with EPIPE on a stream with no error listener, which threw
 * out of the test as an uncaught error. A child that never reads its stdin is normal (most commands do not), so the
 * write error is the child's business, never the test's: runCli must still resolve with the child's exit.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { runCli } from './test-fixtures/spawn-cli.js';

describe('runCli: a child that exits without reading stdin', () => {
  it('resolves with the exit code when the stdin write hits EPIPE (more input than one pipe buffer, child already gone)', async () => {
    const entry = join(mkdtempSync(join(tmpdir(), 'revition-epipe-')), 'exit-now.mjs');
    writeFileSync(entry, 'process.exit(3);\n');
    // 4 MiB: far beyond a pipe buffer, so the write cannot complete before the child has exited and closed its end.
    const r = await runCli(entry, [], { input: 'x'.repeat(4 * 1024 * 1024) });
    assert.equal(r.code, 3);
  });
});
