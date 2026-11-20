import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { execDecision, runLocalCommand } from './exec.js';
import { effectivePolicy } from './policy.js';

/** T3.3.2 AC4 - a command outside the allowlist needs approval; `never` refuses every command. */
describe('T3.3.2 exec policy', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'exec-')));

  it('[CLI-T3.3.2-AC4] allowlist mode: listed commands run, anything else needs approval (whitespace-normalised, no prefix match)', () => {
    const p = effectivePolicy(root, {}, { execMode: 'allowlist', execAllowlist: ['npm test', 'revition test'] });
    assert.equal(execDecision(p, 'npm test'), 'allow');
    assert.equal(execDecision(p, '  npm   test '), 'allow');
    for (const c of ['npm test; rm -rf ~', 'npm test && curl x', 'npm testx', 'rm -rf .', 'npm run build']) assert.equal(execDecision(p, c), 'ask', c);
  });

  it('[CLI-T3.3.2-AC4] ask mode asks for everything (the default); never mode refuses everything', () => {
    assert.equal(execDecision(effectivePolicy(root), 'npm test'), 'ask');
    const never = effectivePolicy(root, {}, { execMode: 'never' });
    for (const c of ['npm test', 'ls']) assert.equal(execDecision(never, c), 'deny');
  });

  it('an approved command runs in the root without the CLI credential in its environment; its output is redacted', async () => {
    const before = process.env['REVITION_TOKEN'];
    process.env['REVITION_TOKEN'] = `rvt_${'Q'.repeat(40)}`;
    try {
      const p = effectivePolicy(root, {}, { network: 'allow' });
      const r = await runLocalCommand(p, 'pwd; echo "tok=${REVITION_TOKEN:-none}"; echo "key sk-ant-' + 'A'.repeat(30) + '"');
      assert.equal(r.exitCode, 0);
      assert.match(r.output, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(r.output, /tok=none/);
      assert.doesNotMatch(r.output, /sk-ant-A/);
    } finally {
      if (before === undefined) delete process.env['REVITION_TOKEN'];
      else process.env['REVITION_TOKEN'] = before;
    }
  });
});
