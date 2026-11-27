/**
 * T2.5.1 - the Phase 2 developer journey against a REAL platform (staging, or a local platform server for the
 * pre-staging proof), on the installed / built CLI, run once per OS (macOS, Linux, Windows). Automated with a personal
 * access token; the reviewer's approval and the human publish happen in the portal (manual-assisted:
 * docs/evidence/phase2.md records them).
 *
 *   REVITION_E2E_HOST           the platform host (api.revition.com, or 127.0.0.1:4000 locally)               required
 *   REVITION_E2E_TOKEN          a cli:read + cli:write + cli:submit PAT of the dedicated test developer        required
 *   REVITION_E2E_APP            the test developer's test app (apps have no delete route: one dedicated app)
 *   REVITION_E2E_CREATE_APP=1   create the test app instead (`apps create`; the user archives it afterwards)
 *   REVITION_E2E_PAID_OK=1      allow the metered sandbox step (`dev --sandbox --once`)
 *   REVITION_E2E_EVAL_QUOTE     the quote id the user approved: `eval run` fires only when the fresh quote matches
 *   REVITION_E2E_EVAL_CAP_CREDITS  OR a cap in credits (step 10 GO): fires when the fresh quote is within it, <= 4 model calls
 *   REVITION_E2E_VERSION        the version to submit (x.y.z, above every earlier submission)
 *   REVITION_E2E_REVIEW_WAIT_MIN minutes to wait for the reviewer to certify the submission (default 0: not waited)
 *   REVITION_CLI_BIN            the CLI entry (default packages/cli/bin/run)
 *
 * Paid steps are quoted and approved by the user before they run; the spend is read back after. The token never
 * appears in output or any CLI file (leak suite). Cleanup: keys revoked, the secret removed, the sandbox deleted;
 * the journey token is revoked last.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const E = process.env;
const HOST = E['REVITION_E2E_HOST'] ?? '';
const TOKEN = E['REVITION_E2E_TOKEN'] ?? '';
const VERSION = E['REVITION_E2E_VERSION'] ?? '';
const APPROVED_QUOTE = E['REVITION_E2E_EVAL_QUOTE'] ?? '';
const BIN = E['REVITION_CLI_BIN'] ?? fileURLToPath(new URL('../packages/cli/bin/run', import.meta.url));
const SKIP = HOST === '' || TOKEN === '' ? 'set REVITION_E2E_HOST and REVITION_E2E_TOKEN (cli:read, cli:write, cli:submit)' : false;
const SECRET_VALUE = `phase2-${Date.now()}-value`;

const root = mkdtempSync(join(tmpdir(), 'revition-phase2-'));
// APPDATA / LOCALAPPDATA: Windows ignores XDG_* (core config/paths.ts).
const DIRS = {
  XDG_CONFIG_HOME: join(root, 'config'),
  XDG_STATE_HOME: join(root, 'state'),
  XDG_CACHE_HOME: join(root, 'cache'),
  APPDATA: join(root, 'appdata'),
  LOCALAPPDATA: join(root, 'localappdata'),
};
const PROJECT = join(root, 'project');
const captured: string[] = [];
const spend: { step: string; quoteId: string; billedCredits: number | null }[] = [];

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function cli(args: readonly string[], opts: { readonly cwd?: string; readonly input?: string } = {}): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: opts.cwd ?? root,
      env: { ...E, ...DIRS, NO_COLOR: '1', CI: 'true', SSH_CONNECTION: 'phase2-e2e', REVITION_HOST: HOST, REVITION_TOKEN: TOKEN, REVITION_NO_UPDATE_CHECK: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      captured.push(`$ revition ${args.join(' ')}\n${stdout}${stderr}`);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(opts.input ?? '');
  });
}

const data = <T>(r: Run): T => (JSON.parse(r.stdout) as { data: T }).data;

function filesUnder(dir: string): string[] {
  let out: string[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    const p = join(dir, n);
    out = statSync(p).isDirectory() ? [...out, ...filesUnder(p)] : [...out, p];
  }
  return out;
}

describe('Phase 2 developer journey', { skip: SKIP }, () => {
  let appId = E['REVITION_E2E_APP'] ?? '';
  let keyId = '';
  let tokenId = '';

  it('[CLI-T2.5.1-AC1] account -> init (starter) -> generate -> build', async () => {
    const account = await cli(['account', 'status', '--json']);
    assert.equal(account.code, 0, account.stderr);
    const starters = data<{ starters: Array<{ id: string }> }>(await cli(['starters', 'list', '--json'])).starters;
    assert.ok(starters.length > 0, 'the platform lists starters');
    const init = await cli(['init', 'project', '--starter', starters[0]?.id ?? '', ...(appId === '' ? [] : ['--app', appId]), '--project', 'new', '--yes', '--json']);
    assert.equal(init.code, 0, init.stderr);
    const gen = await cli(['generate', 'eval-suite', 'journey', '--yes', '--json'], { cwd: PROJECT });
    assert.equal(gen.code, 0, gen.stderr);
    // The generator writes a schema-valid SKELETON (REVITION-CLI-PLAN.md:2092); the developer then makes it measurable.
    // The platform quotes only a suite with a reference-text or reference-tools dimension and an expected per case.
    const suitePath = join(PROJECT, 'evals', 'journey.json');
    const suite = JSON.parse(readFileSync(suitePath, 'utf8')) as { cases: Array<Record<string, unknown>> };
    const measurable = { ...suite, dimensions: ['task_success'], cases: suite.cases.slice(0, 1).map((c) => ({ ...c, expected: 'A short greeting.' })) };
    writeFileSync(suitePath, `${JSON.stringify(measurable, null, 2)}\n`);
    const build = await cli(['build', '--json'], { cwd: PROJECT });
    assert.ok(build.code === 0 || build.code === 12, `build: ${build.stderr}`);
  });

  // REVITION-CLI-PLAN.md:2540 step "test": `revition test` is built (T2.1.3); the project's own tests run locally,
  // offline, and must pass (the skip that said it was not built was stale).
  it('[CLI-T2.5.1-AC1] test: the project tests run locally (offline) and pass', async () => {
    const t = await cli(['test', '--json'], { cwd: PROJECT });
    assert.equal(t.code, 0, `${t.stdout}${t.stderr}`);
    const r = data<{ passed: number; failed: number }>(t);
    assert.ok(r.passed >= 1, 'at least one test case ran');
    assert.equal(r.failed, 0);
  });

  it('[CLI-T2.5.1-AC1] [CLI-T2.1.4-AC5] dev --sandbox: one run, then the sandbox is deleted (metered: needs REVITION_E2E_PAID_OK=1)', { skip: E['REVITION_E2E_PAID_OK'] === '1' ? false : 'metered: not approved for this run' }, async () => {
    const dev = await cli(['dev', '--sandbox', '--once', '--yes', '--json'], { cwd: PROJECT });
    assert.equal(dev.code, 0, dev.stderr);
    assert.equal(data<{ disposed: boolean }>(dev).disposed, true);
  });

  it('[CLI-T2.5.1-AC1] apps: the test app (created only on request), keys create / rotate / revoke', async () => {
    if (appId === '' && E['REVITION_E2E_CREATE_APP'] === '1') {
      // apps create takes the APP manifest (create.ts:24), not the project's revition.json ({summary, capabilities}).
      const manifestPath = join(root, 'app-manifest.json');
      const manifest = { pluginId: `phase2-e2e-${Date.now()}`, brand: 'Phase 2 E2E', category: 'utility', description: 'CLI phase 2 journey app', version: '0.1.0', dataClasses: [] };
      writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
      const created = await cli(['apps', 'create', '--manifest', manifestPath, '--yes', '--json'], { cwd: PROJECT });
      assert.equal(created.code, 0, `${created.stdout}${created.stderr}`);
      appId = data<{ appId: string }>(created).appId;
    }
    assert.notEqual(appId, '', 'set REVITION_E2E_APP (or REVITION_E2E_CREATE_APP=1)');
    const key = await cli(['apps', 'keys', 'create', appId, '--yes', '--json']);
    assert.equal(key.code, 0, key.stderr);
    keyId = data<{ keyId: string }>(key).keyId;
    const rotated = await cli(['apps', 'keys', 'rotate', appId, keyId, '--yes', '--json']);
    assert.equal(rotated.code, 0, rotated.stderr);
    for (const id of [keyId, data<{ keyId: string }>(rotated).keyId]) {
      const revoked = await cli(['apps', 'keys', 'revoke', appId, id, '--yes']);
      assert.ok(revoked.code === 0 || revoked.code === 5, revoked.stderr);
    }
  });

  it('[CLI-T2.5.1-AC1] secrets set / list / unset (the value from stdin, never printed)', async () => {
    const set = await cli(['secrets', 'set', 'PHASE2_E2E', '--app', appId, '--yes'], { input: SECRET_VALUE });
    assert.equal(set.code, 0, set.stderr);
    const list = data<{ names: Array<{ name: string }> }>(await cli(['secrets', 'list', '--app', appId, '--json']));
    assert.ok(list.names.some((n) => n.name === 'PHASE2_E2E'));
    const unset = await cli(['secrets', 'unset', 'PHASE2_E2E', '--app', appId, '--yes']);
    assert.equal(unset.code, 0, unset.stderr);
  });

  it('[CLI-T2.5.1-AC2] [CLI-T2.3.1-AC1] [CLI-T2.3.1-AC4] [CLI-T2.3.1-AC6] [CLI-T2.3.1-AC7] eval: quoted first; fired only for the quote the user approved; the billed credits recorded', async () => {
    const dry = await cli(['eval', 'run', '--app', appId, '--suite', 'journey', '--dry-run', '--json'], { cwd: PROJECT });
    assert.equal(dry.code, 0, `${dry.stdout}${dry.stderr}`);
    const quote = data<{ quote: { quoteId: string; estCredits: number | null; modelCalls: number } }>(dry).quote;
    // Approved = the exact quote id the user approved, OR (step 10, the user's GO on a capped total) a cap in credits:
    // the fresh quote is within REVITION_E2E_EVAL_CAP_CREDITS and makes at most 4 model calls. Otherwise not run.
    const cap = E['REVITION_E2E_EVAL_CAP_CREDITS'] === undefined ? null : Number(E['REVITION_E2E_EVAL_CAP_CREDITS']);
    // The platform prices an eval only after the run (estCredits null until Arena exposes a per-call price,
    // monorepo devportal/eval/eval-quote.ts:5-6, :63), so a null estimate is bounded by its model calls and the billed
    // amount is asserted within the cap after the run.
    const withinCap = cap !== null && quote.modelCalls <= 4 && (quote.estCredits === null || quote.estCredits <= cap);
    process.stdout.write(`PHASE2_EVAL_QUOTE ${JSON.stringify({ quoteId: quote.quoteId, estCredits: quote.estCredits, modelCalls: quote.modelCalls, cap })}\n`);
    if (!(APPROVED_QUOTE !== '' && APPROVED_QUOTE === quote.quoteId) && !withinCap) {
      // A capped (step-10) fire must run or fail: a quote outside the cap is a failure that shows the quote, never a pass.
      assert.equal(cap, null, `the eval quote is outside the cap ${String(cap)}: ${JSON.stringify(quote)}`);
      spend.push({ step: 'eval', quoteId: quote.quoteId, billedCredits: null });
      return;
    }
    const ran = await cli(['eval', 'run', '--app', appId, '--suite', 'journey', '--yes', '--json'], { cwd: PROJECT });
    assert.equal(ran.code, 0, `${ran.stdout}${ran.stderr}`);
    const billed = data<{ run: { runId?: string; billedCredits?: number } }>(ran).run;
    process.stdout.write(`PHASE2_EVAL_RUN ${JSON.stringify({ runId: billed.runId ?? null, billedCredits: billed.billedCredits ?? null })}\n`);
    assert.equal(typeof billed.billedCredits, 'number', 'the run record carries its billed credits (CLI-T2.3.1-AC3)');
    if (cap !== null) assert.ok((billed.billedCredits ?? 0) <= cap, `billed ${String(billed.billedCredits)} credits within the cap ${cap}`);
    spend.push({ step: 'eval', quoteId: quote.quoteId, billedCredits: billed.billedCredits ?? null });
  });

  it('[CLI-T2.5.1-AC1] submit -> submissions (the reviewer certifies in the portal) -> submissions open', async () => {
    assert.match(VERSION, /^\d+\.\d+\.\d+$/, 'set REVITION_E2E_VERSION');
    const sub = await cli(['submit', '--app', appId, '--version', VERSION, '--yes', '--json'], { cwd: PROJECT });
    assert.equal(sub.code, 0, sub.stderr);
    const deadline = Date.now() + Number(E['REVITION_E2E_REVIEW_WAIT_MIN'] ?? '0') * 60_000;
    let state = data<{ state: string }>(sub).state;
    while (state !== 'certified' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 30_000));
      state = data<{ state: string }>(await cli(['submissions', 'view', VERSION, '--app', appId, '--json'])).state;
    }
    const open = await cli(['submissions', 'open', VERSION, '--app', appId, '--json']);
    assert.equal(open.code, 0, open.stderr);
    assert.equal(data<{ url: string }>(open).url, 'https://developer.revition.com/apps');
  });

  it('[CLI-T2.5.1-AC1] versions list / channels, runs / logs, analytics, audit (client=cli)', async () => {
    for (const args of [['versions', 'list'], ['runs', 'list'], ['analytics']]) {
      const r = await cli([...args, '--app', appId, '--json']);
      assert.equal(r.code, 0, `${args.join(' ')}: ${r.stderr}`);
    }
    const audit = data<{ events: Array<{ client?: string }> }>(await cli(['audit', '--since', '1d', '--json']));
    assert.ok(audit.events.some((e) => e.client === 'cli'), 'the CLI actions of this run carry client=cli (Q4)');
  });

  it('[CLI-T2.5.1-AC1] a direct CLI-token call to a human-only route is refused 403 HUMAN_ACTION_REQUIRED', async () => {
    // A loopback platform (the local server, or the rehearsal) is plain http; every other host is https.
    const origin = /^(127\.0\.0\.1|localhost)(:\d+)?$/u.test(HOST) ? `http://${HOST}` : `https://${HOST}`;
    const res = await fetch(`${origin}/api/v1/foundry/dev/apps/${encodeURIComponent(appId)}/submissions/${VERSION}/publish`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'HUMAN_ACTION_REQUIRED');
  });

  it('[CLI-T2.5.1-AC3] the journey token is revoked; the leak suite finds the token and the secret nowhere', async () => {
    const list = data<{ tokens: Array<{ tokenId: string; prefix: string; revokedAt: string | null }> }>(await cli(['token', 'list', '--json']));
    tokenId = list.tokens.find((t) => t.revokedAt === null && TOKEN.startsWith(t.prefix))?.tokenId ?? '';
    assert.notEqual(tokenId, '');
    // The matrix (.github/workflows/phase2-journey.yml) runs Linux then Windows on ONE token: only the last run revokes
    // it (REVITION_E2E_KEEP_TOKEN=1 on the first). The leak suite below runs on every OS either way.
    if (E['REVITION_E2E_KEEP_TOKEN'] !== '1') assert.equal((await cli(['token', 'revoke', tokenId, '--yes'])).code, 0);
    const all = captured.join('\n');
    assert.equal(all.includes(TOKEN), false, 'the token value was printed');
    assert.equal(all.includes(SECRET_VALUE), false, 'the secret value was printed');
    for (const f of Object.values(DIRS).flatMap((d) => filesUnder(d))) {
      const text = readFileSync(f, 'utf8');
      assert.equal(text.includes(TOKEN) || text.includes(SECRET_VALUE), false, `a secret is stored in ${f}`);
    }
    // The spend against its quotes, for docs/evidence/phase2.md.
    process.stdout.write(`PHASE2_SPEND ${JSON.stringify(spend)}\n`);
  });
});
