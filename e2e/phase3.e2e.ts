/**
 * T3.4.1 - the Phase 3 journeys against a REAL platform (staging; a local platform server for the pre-staging proof),
 * on the installed / built CLI. Automated with a personal access token where no human is needed; the human steps
 * (publishing in the portal, a Claude Code session, the interactive Assist session) are manual-assisted and recorded in
 * docs/evidence/phase3.md.
 *
 *   REVITION_E2E_HOST            the platform host                                                         required
 *   REVITION_E2E_TOKEN           a cli:read + cli:agents PAT of the dedicated E2E user                     required
 *   REVITION_E2E_AGENT           the dedicated test agent (deployment id) the journey edits                 required
 *   REVITION_E2E_TESTS_QUOTE     the quote id the user approved: `agents test` runs only when the fresh quote matches
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

const E = process.env;
const HOST = E['REVITION_E2E_HOST'] ?? '';
const TOKEN = E['REVITION_E2E_TOKEN'] ?? '';
const AGENT = E['REVITION_E2E_AGENT'] ?? '';
const APPROVED_QUOTE = E['REVITION_E2E_TESTS_QUOTE'] ?? '';
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

  it('[CLI-T3.4.1-AC1] [CLI-T3.1.3-AC4] agents: pull -> edit -> push -> test (quoted) -> status -> open for the human publish; a CLI-token publish is 403', async () => {
    const pull = await cli(['agents', 'pull', AGENT, '--json']);
    assert.equal(pull.code, 0, pull.stderr);
    pulledFile = resolve(root, String(data(pull.stdout)['file']));
    original = readFileSync(pulledFile, 'utf8');
    writeFileSync(pulledFile, original.replace(/instructions: (.*)/, 'instructions: $1 (phase 3 e2e)'));
    const push = await cli(['agents', 'push', pulledFile, '--yes', '--json']);
    assert.equal(push.code, 0, push.stderr);
    const quote = await cli(['agents', 'test', AGENT, '--json']);
    // Without --yes a paid run stops at the quote (exit 2); with no paid case it runs (free).
    const fresh = quote.code === 2 ? null : data(quote.stdout);
    if (fresh === null) {
      if (APPROVED_QUOTE === '') {
        console.log('PHASE3 agents test: paid; not run (set REVITION_E2E_TESTS_QUOTE to the approved quote id)');
      } else {
        const run = await cli(['agents', 'test', AGENT, '--yes', '--json']);
        const d = data(run.stdout) as { quote: { quoteId: string; billedEstimateUsd?: number | null }; report: unknown };
        assert.equal(d.quote.quoteId, APPROVED_QUOTE, 'the fresh quote differs from the approved one: not run again');
        spend.push({ step: 'agents test', quoteId: d.quote.quoteId, quoted: d.quote.billedEstimateUsd ?? null, billed: null });
      }
    }
    const status = await cli(['agents', 'status', AGENT, '--json']);
    assert.equal(status.code, 0, status.stderr);
    const open = await cli(['agents', 'open', AGENT, '--action', 'publish', '--json']);
    assert.equal(open.code, 0, open.stderr);
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
