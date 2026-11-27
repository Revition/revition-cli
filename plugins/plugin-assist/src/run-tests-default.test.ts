import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { defaultTestCommand } from './executor/executor.js';
import { notDoneReason } from './ui/session.js';

describe('[CLI-T3.4.1-AC1] Assist run_tests in a Revition project (user re-run as_de5356ef, auditor #595)', () => {
  const dir = (files: readonly string[]): string => {
    const d = mkdtempSync(join(tmpdir(), 'assist-tests-'));
    for (const f of files) writeFileSync(join(d, f), '{}');
    return d;
  };

  it('[CLI-T3.4.1-AC1] a project made by `revition init` (revition.json, no package.json) runs `revition test`', () => {
    assert.equal(defaultTestCommand(dir(['revition.json'])), 'revition test');
  });

  it('[CLI-T3.4.1-AC1] a package.json project keeps `npm test`, and so does a folder that is neither', () => {
    assert.equal(defaultTestCommand(dir(['package.json'])), 'npm test');
    assert.equal(defaultTestCommand(dir(['package.json', 'revition.json'])), 'npm test');
    assert.equal(defaultTestCommand(dir([])), 'npm test');
  });

  it('[CLI-T3.4.1-AC1] a command that ran and failed says its exit code and last line, never a bare "not done"', () => {
    const failed = { tool: 'run_tests', ok: false, output: { exitCode: 1, output: 'npm ERR! enoent\nnpm ERR! missing script: test\n', truncated: false, timedOut: false, networkIsolated: false } } as const;
    assert.equal(notDoneReason(failed as never), 'the command failed (exit 1): npm ERR! missing script: test');
    assert.equal(notDoneReason({ tool: 'run_tests', ok: false, error: 'declined by the developer' } as never), 'declined by the developer');
    assert.equal(
      notDoneReason({ tool: 'run_tests', ok: false, output: { exitCode: null, output: '', timedOut: true } } as never),
      'the command timed out'
    );
    assert.equal(notDoneReason({ tool: 'read_file', ok: false } as never), 'not done');
  });
});
