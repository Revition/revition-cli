import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { effectivePolicy, type PermissionPolicy } from '@revition/cli-core';

import { undoLast } from './backup.js';
import { LocalExecutor, type Approval } from './executor.js';

/** T3.3.2 AC3 - in `ask` mode a write is shown as a diff and applied only after `y`. */
function setup(policy: Partial<PermissionPolicy> = {}, answers: boolean[] = []): { root: string; ex: LocalExecutor; asked: Approval[]; shown: string[]; onAsk: { fn: (() => void) | null } } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wa-')));
  writeFileSync(join(root, 'app.ts'), 'const a = 1;\nconst b = 2;\n');
  const asked: Approval[] = [];
  const shown: string[] = [];
  const onAsk: { fn: (() => void) | null } = { fn: null };
  const ex = new LocalExecutor({
    policy: { ...effectivePolicy(root), ...policy },
    approve: async (a) => {
      asked.push(a);
      onAsk.fn?.();
      return answers.shift() ?? false;
    },
    show: (t) => shown.push(t),
  });
  return { root, ex, asked, shown, onAsk };
}

const write = { tool: 'write_file', args: { path: 'app.ts', content: 'const a = 1;\nconst b = 3;\n' }, reason: 'fix b' };

describe('T3.3.2 write approval', () => {
  it('[CLI-T3.3.2-AC3] ask mode: the diff is shown and the write waits; `n` leaves the file unchanged', async () => {
    const s = setup({}, [false]);
    const r = await s.ex.handle(write);
    assert.equal(r.ok, false);
    assert.match(String(r.error), /declined/);
    assert.equal(readFileSync(join(s.root, 'app.ts'), 'utf8'), 'const a = 1;\nconst b = 2;\n');
    assert.equal(s.asked.length, 1);
    const a = s.asked[0] as Extract<Approval, { kind: 'write' }>;
    assert.equal(a.reason, 'fix b');
    assert.match(a.diff, /-const b = 2;\n\+const b = 3;/);
    assert.equal(s.shown.length, 1, 'the diff is visible before the decision');
  });

  it('[CLI-T3.3.2-AC3] `y` applies it, with a backup that undo restores', async () => {
    const s = setup({}, [true]);
    const r = await s.ex.handle(write);
    assert.equal(r.ok, true, String(r.error));
    assert.equal(readFileSync(join(s.root, 'app.ts'), 'utf8'), 'const a = 1;\nconst b = 3;\n');
    assert.equal(await undoLast(s.root), 'app.ts');
    assert.equal(readFileSync(join(s.root, 'app.ts'), 'utf8'), 'const a = 1;\nconst b = 2;\n');
  });

  it('[CLI-T3.3.2-AC3] each write in ask mode asks again; a patch is approved the same way; a new file is undone by removal', async () => {
    const s = setup({}, [true, true, true]);
    assert.equal((await s.ex.handle(write)).ok, true);
    const patch = ['--- a/app.ts', '+++ b/app.ts', '@@ -1,2 +1,2 @@', '-const a = 1;', '+const a = 10;', ' const b = 3;', ''].join('\n');
    assert.equal((await s.ex.handle({ tool: 'apply_patch', args: { path: 'app.ts', patch }, reason: 'bump a' })).ok, true);
    assert.equal(readFileSync(join(s.root, 'app.ts'), 'utf8'), 'const a = 10;\nconst b = 3;\n');
    assert.equal((await s.ex.handle({ tool: 'write_file', args: { path: 'src/new.ts', content: 'x\n' }, reason: 'new file' })).ok, true);
    assert.equal(s.asked.length, 3);
    await undoLast(s.root);
    assert.equal(existsSync(join(s.root, 'src', 'new.ts')), false);
  });

  it('edge: a file changed while the diff was on screen is not written (stale-diff check); a stale patch is refused', async () => {
    const s = setup({}, [true, true]);
    s.onAsk.fn = () => writeFileSync(join(s.root, 'app.ts'), 'edited elsewhere\n');
    const r = await s.ex.handle(write);
    assert.equal(r.ok, false);
    assert.match(String(r.error), /changed since the diff/);
    assert.equal(readFileSync(join(s.root, 'app.ts'), 'utf8'), 'edited elsewhere\n');
    s.onAsk.fn = null;
    const stale = ['@@ -1,1 +1,1 @@', '-const a = 1;', '+const a = 2;', ''].join('\n');
    const p = await s.ex.handle({ tool: 'apply_patch', args: { path: 'app.ts', patch: stale }, reason: 'x' });
    assert.equal(p.ok, false);
    assert.match(String(p.error), /does not match/);
  });

  it('writeMode never refuses without asking; auto-in-session asks once, then applies; a request without a reason is refused', async () => {
    const never = setup({ writeMode: 'never' });
    assert.match(String((await never.ex.handle(write)).error), /writes are off/);
    assert.equal(never.asked.length, 0);
    const auto = setup({ writeMode: 'auto-in-session' }, [true]);
    assert.equal((await auto.ex.handle(write)).ok, true);
    assert.equal((await auto.ex.handle({ ...write, args: { path: 'app.ts', content: 'z\n' } })).ok, true);
    assert.equal(auto.asked.length, 1);
    assert.match(String((await auto.ex.handle({ ...write, reason: ' ' })).error), /needs a reason/);
  });

  it('[CLI-T3.3.2-AC4] through the executor: a non-allowlisted command is asked for and does not run when declined', async () => {
    const s = setup({ execMode: 'allowlist', execAllowlist: ['node -e ""'] }, [false]);
    const r = await s.ex.handle({ tool: 'run_command', args: { command: 'touch ran.txt' }, reason: 'try' });
    assert.equal(r.ok, false);
    assert.equal(existsSync(join(s.root, 'ran.txt')), false);
    assert.deepEqual(s.asked.map((a) => a.kind), ['exec']);
  });
});
