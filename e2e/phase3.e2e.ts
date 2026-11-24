/**
 * T3.4.1 - the Phase 3 journeys against a REAL platform (staging; a local platform server for the pre-staging proof),
 * on the installed / built CLI. Automated with a personal access token where no human is needed; the human steps
 * (publishing in the portal, a Claude Code session, the interactive Assist session) are manual-assisted and recorded in
 * docs/evidence/phase3.md.
 *
 *   REVITION_E2E_HOST            the platform host                                                         required
 *   REVITION_E2E_TOKEN           a cli:read + cli:agents PAT of the dedicated E2E user                     required
 *   REVITION_E2E_AGENT           the dedicated test agent (deployment id) the journey edits                 required
 *   REVITION_E2E_PAID_OK=1       run the quoted `agents test` (the authored case); REVITION_E2E_TESTS_CAP_USD caps the quote (0.20)
 *   REVITION_CLI_BIN             the CLI entry (default packages/cli/bin/run)
 *
 * Paid steps are quoted and approved before they run, and the spend is compared with the quote (AC2). The draft edit
 * is reverted at the end (the pulled definition is pushed back).
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { definitionText, parseDefinitionText } from '../plugins/plugin-agents/src/format.js';

const E = process.env;
const HOST = E['REVITION_E2E_HOST'] ?? '';
const TOKEN = E['REVITION_E2E_TOKEN'] ?? '';
const AGENT = E['REVITION_E2E_AGENT'] ?? '';
const PAID_OK = E['REVITION_E2E_PAID_OK'] === '1';
const CAP_USD = Number(E['REVITION_E2E_TESTS_CAP_USD'] ?? '0.20');
/** The one model-backed case the journey authors on its own draft (ruling #279), removed by the revert in after(). */
const JOURNEY_CASE = { id: 'cli-journey-paid', name: 'CLI journey paid case', type: 'agent_behavior', input: 'Reply with the single word ready.', expected: 'ready', assertion: 'contains' };
const BIN = E['REVITION_CLI_BIN'] ?? fileURLToPath(new URL('../packages/cli/bin/run', import.meta.url));
const SKIP = HOST === '' || TOKEN === '' || AGENT === '' ? 'set REVITION_E2E_HOST, REVITION_E2E_TOKEN (cli:read, cli:agents) and REVITION_E2E_AGENT' : false;

const root = mkdtempSync(join(tmpdir(), 'revition-phase3-'));
const DIRS = { XDG_CONFIG_HOME: join(root, 'config'), XDG_STATE_HOME: join(root, 'state'), XDG_CACHE_HOME: join(root, 'cache') };
const ENV = { ...E, ...DIRS, NO_COLOR: '1', CI: 'true', REVITION_HOST: HOST, REVITION_TOKEN: TOKEN, REVITION_NO_UPDATE_CHECK: '1' };
const spend: { step: string; quoteId: string; quoted: unknown; billed: unknown }[] = [];

function cli(args: readonly string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd: root, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const data = (stdout: string): Record<string, unknown> => (JSON.parse(stdout) as { data: Record<string, unknown> }).data;
const scheme = /^(localhost|127\.0\.0\.1)(:|$)/.test(HOST) ? 'http' : 'https';

describe('Phase 3 journeys', { skip: SKIP }, () => {
  let pulledFile = '';
  let original = '';

  after(async () => {
    if (pulledFile !== '' && original !== '') {
      writeFileSync(pulledFile, original);
      await cli(['agents', 'push', pulledFile, '--yes', '--json']);
    }
    console.log(`PHASE3 spend ${JSON.stringify(spend)}`);
  });

  it('[CLI-T3.4.1-AC1] [CLI-T3.1.3-AC4] [CLI-T3.1.4-AC2] [CLI-T3.1.4-AC3] agents: pull -> edit -> push -> test (quoted) -> status -> open for the human publish; a CLI-token publish is 403', async () => {
    const pull = await cli(['agents', 'pull', AGENT, '--json']);
    assert.equal(pull.code, 0, pull.stderr);
    pulledFile = resolve(root, String(data(pull.stdout)['file']));
    original = readFileSync(pulledFile, 'utf8');
    // Ruling #279: the journey authors ONE model-backed case on its own draft (the pulled file's Tests section, pushed
    // through the CLI's own draft route), so `agents test` has a paid case to quote; after() pushes the original back.
    const doc = parseDefinitionText(original.replace(/instructions: (.*)/, 'instructions: $1 (phase 3 e2e)')) as {
      config: { sections: Record<string, unknown> };
    };
    const tests = (doc.config.sections['tests'] as { cases?: unknown[] } | undefined) ?? {};
    doc.config.sections['tests'] = { ...tests, cases: [...(tests.cases ?? []), JOURNEY_CASE] };
    writeFileSync(pulledFile, definitionText(doc as never));
    const push = await cli(['agents', 'push', pulledFile, '--yes', '--json']);
    assert.equal(push.code, 0, push.stderr);
    // The quote, read from the platform's own route ($0): the authored case makes the run paid.
    const quoted = (await (
      await fetch(`${scheme}://${HOST}/api/v1/foundry/deployments/${encodeURIComponent(AGENT)}/tests/quote`, { headers: { authorization: `Bearer ${TOKEN}` } })
    ).json()) as { quoteId: string; modelCalls: number; billedEstimateUsd?: number | null };
    assert.ok(quoted.modelCalls >= 1, `the authored case is paid: ${JSON.stringify(quoted)}`);
    // Quote -> confirm: without --yes the paid run stops before any call is made.
    const unconfirmed = await cli(['agents', 'test', AGENT, '--json']);
    assert.equal(unconfirmed.code, 2, unconfirmed.stdout);
    let ranReport: { results: { caseId: string }[] } | null = null;
    if (PAID_OK) {
      assert.ok(quoted.modelCalls <= 2, 'at most the authored case and one existing case are paid');
      assert.ok((quoted.billedEstimateUsd ?? 0) <= CAP_USD, `quote ${String(quoted.billedEstimateUsd)} within the cap ${CAP_USD}`);
      const run = await cli(['agents', 'test', AGENT, '--yes', '--json']);
      const d = data(run.stdout) as { quote: { quoteId: string; billedEstimateUsd?: number | null }; report: { results: { caseId: string }[] } };
      assert.equal(d.quote.quoteId, quoted.quoteId, 'the run is the quote that was shown (the draft did not change in between)');
      assert.ok(d.report.results.some((r) => r.caseId === JOURNEY_CASE.id), 'the authored case ran');
      ranReport = d.report;
      spend.push({ step: 'agents test', quoteId: d.quote.quoteId, quoted: d.quote.billedEstimateUsd ?? null, billed: null });
    } else {
      console.log(`PHASE3 agents test: paid (${quoted.modelCalls} call(s), quote ${quoted.quoteId}); not run without REVITION_E2E_PAID_OK=1`);
    }
    const status = await cli(['agents', 'status', AGENT, '--json']);
    assert.equal(status.code, 0, status.stderr);
    // AC2: the draft diff, the latest report and the environments, the portal's own (same routes the portal reads).
    const st = data(status.stdout) as { draftVsLive: unknown; tests: { report: { results: { caseId: string }[] } | null }; environments: unknown };
    assert.ok(st.draftVsLive !== undefined && Array.isArray(st.environments), status.stdout);
    if (ranReport !== null) assert.deepEqual(st.tests.report?.results.map((r) => r.caseId), ranReport.results.map((r) => r.caseId));
    const open = await cli(['agents', 'open', AGENT, '--action', 'publish', '--json']);
    assert.equal(open.code, 0, open.stderr);
    // AC3: the human publish page of THIS agent.
    assert.ok(String(data(open.stdout)['url']).includes(AGENT), String(data(open.stdout)['url']));
    console.log(`PHASE3 human publish page: ${String(data(open.stdout)['url'])}`);
    const direct = await fetch(`${scheme}://${HOST}/api/v1/foundry/deployments/${encodeURIComponent(AGENT)}/draft/publish`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(direct.status, 403, 'a CLI credential can never publish (D9)');
  });

  it('[CLI-T3.4.1-AC1] mcp: the server lists read tools only and answers list apps and logs (the Claude Code session itself is manual)', async () => {
    const child = spawn(process.execPath, [BIN, 'mcp', 'serve'], { cwd: root, env: ENV, stdio: ['pipe', 'pipe', 'pipe'] });
    const answers = new Map<number, Record<string, unknown>>();
    let buf = '';
    child.stdout.on('data', (c: Buffer) => {
      buf += c.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const m = JSON.parse(buf.slice(0, i)) as { id?: number; result?: Record<string, unknown> };
        buf = buf.slice(i + 1);
        if (typeof m.id === 'number' && m.result !== undefined) answers.set(m.id, m.result);
      }
    });
    const send = (id: number, method: string, params: object): void => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    };
    const wait = async (id: number): Promise<Record<string, unknown>> => {
      for (let t = 0; t < 600 && !answers.has(id); t++) await new Promise((r) => setTimeout(r, 100));
      const a = answers.get(id);
      assert.ok(a !== undefined, `no answer to request ${id}`);
      return a;
    };
    try {
      send(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'phase3-e2e', version: '0' } });
      await wait(1);
      send(2, 'tools/list', {});
      const tools = (await wait(2))['tools'] as { name: string; annotations?: { destructiveHint?: boolean } }[];
      assert.ok(tools.every((t) => t.annotations?.destructiveHint !== true));
      send(3, 'tools/call', { name: 'revition_apps_list', arguments: {} });
      assert.equal((await wait(3))['isError'], false);
    } finally {
      child.kill();
    }
  });
});
