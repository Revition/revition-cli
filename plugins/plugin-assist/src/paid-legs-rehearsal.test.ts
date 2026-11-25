import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { effectivePolicy, memoryIo } from '@revition/cli-core';

import type { ToolResult } from './executor/executor.js';
import type { AssistEvent } from './ui/render.js';
import { AssistRun } from './ui/session.js';
import { StopSignal } from './ui/interrupt.js';

/**
 * $0 REHEARSAL of CLI-T3.3.3-AC1 (REVITION-CLI-PLAN.md:2913; the paid staging session is step 10): a guided session
 * builds and tests a starter extension, with the harness's turns SCRIPTED (no model, no platform, no host), and every
 * local action REAL: the starter's own test runs and fails, the fix is applied after a y, the test runs again and
 * passes, all inside the budget. The same session code (AssistRun) the real command uses.
 */
const cost = (spent: number): AssistEvent => ({ type: 'costUpdate', turnCredits: 1, spentCredits: spent, budgetCredits: 50, remainingCredits: 50 - spent });

function starter(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'assist-starter-')));
  mkdirSync(join(root, 'src'));
  // A plain test script (exit 1 on failure): `node --test` here would inherit this runner's test context and skip.
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'starter', private: true, type: 'module', scripts: { test: 'node greet.check.mjs' } }));
  writeFileSync(join(root, 'src', 'greet.js'), "export const greet = (name) => 'helo ' + name;\n");
  writeFileSync(join(root, 'greet.check.mjs'), "import assert from 'node:assert/strict';\nimport { greet } from './src/greet.js';\nassert.equal(greet('ada'), 'hello ada');\nconsole.log('1 test passed');\n");
  return root;
}

describe('$0 rehearsal: the guided Assist session (step 10)', () => {
  it('[CLI-T3.3.3-AC1] rehearsal: a guided session builds and tests a starter: failing test -> fix applied -> tests pass, within budget', { timeout: 60_000 }, async () => {
    const root = starter();
    const io = memoryIo({ tty: true, answers: ['y', 'y', 'y', '/exit'] });
    const sent: { userMessage: string; toolResults: readonly ToolResult[] }[] = [];
    const turns: AssistEvent[][] = [
      [{ type: 'assistantText', text: 'Running the tests first.' }, { type: 'toolRequest', tool: 'run_tests', args: {}, reason: 'see what fails' }, cost(1)],
      [{ type: 'toolRequest', tool: 'write_file', args: { path: 'src/greet.js', content: "export const greet = (name) => 'hello ' + name;\n" }, reason: 'fix the typo' }, cost(2)],
      [{ type: 'toolRequest', tool: 'run_tests', args: {}, reason: 'confirm the fix' }, cost(3)],
      [{ type: 'assistantText', text: 'The starter builds and its test passes.' }, cost(4), { type: 'done', reason: 'end' }],
    ];
    let n = 0;
    const run = new AssistRun({
      io,
      env: {},
      policy: effectivePolicy(root),
      interactive: true,
      json: false,
      stop: new StopSignal(),
      createSession: async () => ({ sessionId: 'as_r', budgetCredits: 50, spentCredits: 0, status: 'open' }),
      sendTurn: async (_id, body) => {
        sent.push(body);
        const events = turns[n] ?? [{ type: 'done', reason: 'end' }];
        n++;
        return { turn: n, status: 'open', events };
      },
    });
    const out = await run.run({ goal: 'make the starter test pass', mode: 'edit', budgetCredits: 50, resume: null });
    const results = sent.flatMap((s) => s.toolResults);
    assert.deepEqual(results.map((r) => r.ok), [false, true, true], `tests fail, the fix applies, tests pass: ${JSON.stringify(results[0]?.output).slice(0, 1500)}`);
    assert.equal(readFileSync(join(root, 'src', 'greet.js'), 'utf8'), "export const greet = (name) => 'hello ' + name;\n");
    assert.deepEqual(out.actions.map((a) => [a.tool, a.ok]), [['run_tests', false], ['write_file', true], ['run_tests', true]]);
    assert.match(io.stderr(), /4 credits of the 50 credits budget/);
  });
});
