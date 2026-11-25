import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { effectivePolicy, memoryIo, SPINNER_FRAMES, uiString, type PermissionPolicy } from '@revition/cli-core';

import type { ToolResult } from './executor/executor.js';
import { assertConformsToSchema } from './test-fixtures/json-conformance.js';
import { CORVITO_BIN, REVITION_BIN, runBin, startMockAssist } from './test-fixtures/mock-assist.js';
import { ESC, StopSignal, type KeyInput } from './ui/interrupt.js';
import type { AssistEvent } from './ui/render.js';
import { AssistRun } from './ui/session.js';

/** T3.3.3 - `revition assist` scripted against fake turns (assist-ui.test.ts), and both real entry points. */
const cost = (spent: number): AssistEvent => ({ type: 'costUpdate', turnCredits: 1, spentCredits: spent, budgetCredits: 5, remainingCredits: 5 - spent });

interface Harness {
  readonly root: string;
  readonly io: ReturnType<typeof memoryIo>;
  readonly sent: { userMessage: string; toolResults: readonly ToolResult[] }[];
  readonly stop: StopSignal;
  readonly run: AssistRun;
}

function harness(turns: AssistEvent[][], o: { answers?: string[]; tty?: boolean; env?: Record<string, string>; edit?: boolean; json?: boolean; keys?: KeyInput; statuses?: string[]; duringTurn?: () => void } = {}): Harness {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'aui-')));
  writeFileSync(join(root, 'app.ts'), 'const v = 1;\n');
  const io = memoryIo({ tty: o.tty ?? true, answers: o.answers ?? [] });
  const base = effectivePolicy(root);
  const policy: PermissionPolicy = o.edit === true ? base : { ...base, writeMode: 'never', execMode: 'never' };
  const sent: Harness['sent'] = [];
  const stop = new StopSignal();
  let n = 0;
  const run = new AssistRun({
    io,
    env: o.env ?? {},
    policy,
    interactive: o.tty ?? true,
    json: o.json ?? false,
    stop,
    ...(o.keys === undefined ? {} : { keys: o.keys }),
    createSession: async () => ({ sessionId: 'as_1', budgetCredits: 5, spentCredits: 0, status: 'open' }),
    sendTurn: async (_id, body) => {
      sent.push(body);
      o.duringTurn?.();
      const events = turns[n] ?? [{ type: 'done', reason: 'end' }];
      const status = o.statuses?.[n] ?? 'open';
      n++;
      return { turn: n, status, events };
    },
  });
  return { root, io, sent, stop, run };
}

const writeReq: AssistEvent = { type: 'toolRequest', tool: 'write_file', args: { path: 'app.ts', content: 'const v = 2;\n' }, reason: 'bump v' };

describe('T3.3.3 assist UX (scripted)', () => {
  it('[CLI-T3.3.3-AC3] a change applied after y is restored by /undo (from its local backup); /diff shows it', async () => {
    const h = harness([[writeReq, cost(1)], [{ type: 'assistantText', text: 'changed v' }, cost(2)]], { edit: true, answers: ['y', '/diff', '/undo', '/exit'] });
    const out = await h.run.run({ goal: 'bump v', mode: 'edit', budgetCredits: 5, resume: null });
    assert.equal(h.sent.length, 2);
    assert.equal(h.sent[1]?.toolResults[0]?.ok, true, 'the change was applied before /undo');
    assert.equal(readFileSync(join(h.root, 'app.ts'), 'utf8'), 'const v = 1;\n');
    const err = h.io.stderr();
    assert.match(err, /-const v = 1;\n\+const v = 2;/);
    assert.match(err, /restored app\.ts/);
    assert.deepEqual(out.actions.map((a) => [a.tool, a.ok]), [['write_file', true], ['undo', true]]);
    assert.match(err, /cost: 2 credits of the 5 credits budget/);
  });

  it('[CLI-T3.3.3-AC4] accessible mode (REVITION_ACCESSIBLE=1): no spinner frame anywhere; on a plain terminal the progress animates', async () => {
    const turns = (): AssistEvent[][] => [[{ type: 'assistantText', text: 'hello' }, cost(1)]];
    const a11y = harness(turns(), { env: { REVITION_ACCESSIBLE: '1' }, answers: ['/exit'] });
    await a11y.run.run({ goal: 'hi', mode: 'ask', budgetCredits: 5, resume: null });
    const all = a11y.io.stdout() + a11y.io.stderr();
    for (const f of SPINNER_FRAMES) assert.ok(!all.includes(f), `frame ${f} in accessible mode`);
    assert.match(all, /thinking\.\.\./);
    assert.match(all, /hello/);
    const plain = harness(turns(), { answers: ['/exit'] });
    await plain.run.run({ goal: 'hi', mode: 'ask', budgetCredits: 5, resume: null });
    assert.ok(SPINNER_FRAMES.some((f) => plain.io.stderr().includes(f)), 'the control: a TTY without accessible mode animates');
  });

  it('Esc during a turn: the turn in flight completes and its cost is shown; its tool requests do not run; no further turn', async () => {
    const keys = Object.assign(new EventEmitter(), { isTTY: true, setRawMode: (): void => undefined, resume: (): void => undefined, pause: (): void => undefined }) as unknown as KeyInput & EventEmitter;
    const h = harness([[writeReq, cost(1)], [{ type: 'assistantText', text: 'never' }]], { edit: true, keys, duringTurn: () => keys.emit('data', Buffer.from([ESC])) });
    const out = await h.run.run({ goal: 'bump v', mode: 'edit', budgetCredits: 5, resume: null });
    assert.equal(h.sent.length, 1);
    assert.equal(out.stoppedByUser, true);
    assert.equal(readFileSync(join(h.root, 'app.ts'), 'utf8'), 'const v = 1;\n');
    assert.match(h.io.stderr(), /turn in flight completes and is billed/);
    assert.match(h.io.stderr(), /cost: 1 credits of the 5 credits budget/);
  });

  it('non-interactive ask mode is read-only: a requested write is refused and reported; the platform budget stop ends the session', async () => {
    const h = harness([[writeReq, cost(1)], [{ type: 'assistantText', text: 'ok' }, cost(2), { type: 'done', reason: 'finished' }]], { tty: false, json: true });
    const out = await h.run.run({ goal: 'look', mode: 'ask', budgetCredits: 5, resume: null });
    assert.equal(h.sent.length, 2);
    assert.match(String(h.sent[1]?.toolResults[0]?.error), /writes are off/);
    assert.equal(readFileSync(join(h.root, 'app.ts'), 'utf8'), 'const v = 1;\n');
    assert.deepEqual(out.text, ['ok']);
    assert.equal(h.io.stdout(), '', '--json: nothing but the envelope (written by the command)');
    const capped = harness([[writeReq, cost(5)]], { edit: true, statuses: ['budget_reached'], answers: ['y'] });
    await capped.run.run({ goal: 'x', mode: 'edit', budgetCredits: 5, resume: null });
    assert.equal(capped.sent.length, 1);
  });
});

describe('T3.3.3 the two entry points', () => {
  it('[CLI-T3.3.3-AC5] `corvito` and `revition assist` are the same command: identical output and identical platform calls', async () => {
    const turns = [[{ type: 'assistantText', text: 'This project has one file.' }, { type: 'costUpdate', turnCredits: 0.5, spentCredits: 0.5, budgetCredits: 5, remainingCredits: 4.5 }, { type: 'done', reason: 'answered' }]];
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'aep-')));
    writeFileSync(join(cwd, 'index.ts'), 'export {};\n');
    const args = ['summarise this project', '--mode', 'ask', '--budget', '5', '--no-input', '--json'];
    const runs = [];
    // One platform for both (the same host in both outputs); each run gets the same scripted turn.
    const mock = await startMockAssist([...turns, ...turns]);
    try {
      for (const [bin, prefix] of [[REVITION_BIN, ['assist']], [CORVITO_BIN, []]] as const) {
        const home = mkdtempSync(join(tmpdir(), 'aep-h-'));
        const from = mock.seen.length;
        const r = await runBin(bin, [...prefix, ...args], cwd, { REVITION_HOST: mock.host, HOME: home, XDG_CONFIG_HOME: join(home, 'c'), XDG_STATE_HOME: join(home, 's'), XDG_CACHE_HOME: join(home, 'k'), APPDATA: join(home, 'a'), LOCALAPPDATA: join(home, 'l') });
        runs.push({ r, seen: mock.seen.slice(from) });
      }
    } finally {
      mock.close();
    }
    const [a, b] = runs;
    assert.equal(a?.r.code, 0, a?.r.stderr);
    assert.deepEqual(JSON.parse(b?.r.stdout ?? ''), JSON.parse(a?.r.stdout ?? ''));
    assert.deepEqual(b?.seen, a?.seen);
    assertConformsToSchema(a?.r.stdout ?? ''); // T3.2.1 AC1: the published schema of `assist`
    const env = JSON.parse(a?.r.stdout ?? '') as { command: string; data: { text: string[]; status: string } };
    assert.equal(env.command, 'assist');
    assert.deepEqual(env.data.text, ['This project has one file.']);
    assert.deepEqual(a?.seen.map((s) => s.path), ['/dev/assist/sessions', '/dev/assist/sessions/as_1/turns']);
    assert.equal((a?.seen[0]?.body as { mode: string; budgetCredits: number }).mode, 'ask');
    const help = await Promise.all([runBin(REVITION_BIN, ['assist', '--help'], cwd, {}), runBin(CORVITO_BIN, ['--help'], cwd, {})]);
    assert.equal(help[1].stdout, help[0].stdout);
    assert.ok(help[0].stdout.includes(uiString('product.assistName')), 'help shows product.assistName (en.json)');
  });

  it('edit mode needs a terminal (a usage error, exit 2); a new session needs a budget', async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'aep2-')));
    const mock = await startMockAssist([]);
    try {
      const env = { REVITION_HOST: mock.host };
      const edit = await runBin(REVITION_BIN, ['assist', 'x', '--mode', 'edit', '--budget', '5', '--json'], cwd, env);
      assert.equal(edit.code, 2);
      assert.equal((JSON.parse(edit.stdout) as { error: { code: string } }).error.code, 'EDIT_NEEDS_TERMINAL');
      const nobudget = await runBin(REVITION_BIN, ['assist', 'x', '--json'], cwd, env);
      assert.equal((JSON.parse(nobudget.stdout) as { error: { code: string } }).error.code, 'BUDGET_REQUIRED');
      assert.equal(mock.seen.length, 0, 'nothing reached the platform');
    } finally {
      mock.close();
    }
  });
});
