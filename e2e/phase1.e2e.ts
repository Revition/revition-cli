/**
 * T1.6.1 - the Phase 1 journey against a REAL platform (staging, or a local platform server for the pre-staging
 * proof), on the installed / built CLI. Automated with a CI personal access token; the browser login, the device
 * approval and the portal revoke are manual-assisted (docs/evidence/phase1.md records their real outputs).
 *
 *   REVITION_E2E_HOST       the platform host (e.g. api.revition.com, or 127.0.0.1:4000 locally)    required
 *   REVITION_E2E_TOKEN      a cli:read personal access token of the dedicated test user             required
 *   REVITION_E2E_EXPECT_426 =<the raised minimum> when the platform's MIN_CLI_VERSION was raised for the 426 probe run
 *   REVITION_CLI_BIN        the CLI entry (default packages/cli/bin/run)
 *
 * No paid call is made. The token is never printed; the leak suite scans every captured output and the CLI's
 * state / config / cache directories for it. The journey ends by revoking its own token.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const HOST = process.env['REVITION_E2E_HOST'] ?? '';
const TOKEN = process.env['REVITION_E2E_TOKEN'] ?? '';
const EXPECT_426 = process.env['REVITION_E2E_EXPECT_426'] ?? '';
const BIN = process.env['REVITION_CLI_BIN'] ?? fileURLToPath(new URL('../packages/cli/bin/run', import.meta.url));
const SKIP = HOST === '' || TOKEN === '' ? 'set REVITION_E2E_HOST and REVITION_E2E_TOKEN (a cli:read PAT of the test user)' : false;

const root = mkdtempSync(join(tmpdir(), 'revition-phase1-'));
// APPDATA / LOCALAPPDATA: Windows ignores XDG_* (core config/paths.ts).
const DIRS = {
  XDG_CONFIG_HOME: join(root, 'config'),
  XDG_STATE_HOME: join(root, 'state'),
  XDG_CACHE_HOME: join(root, 'cache'),
  APPDATA: join(root, 'appdata'),
  LOCALAPPDATA: join(root, 'localappdata'),
};
const captured: string[] = [];

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function cli(args: readonly string[]): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env: { ...process.env, ...DIRS, NO_COLOR: '1', CI: 'true', REVITION_HOST: HOST, REVITION_TOKEN: TOKEN, REVITION_NO_UPDATE_CHECK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
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
  });
}

const json = <T>(r: Run): T => (JSON.parse(r.stdout) as { data: T }).data;

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

// The 426 probe is its own run: with the platform minimum raised, every call is refused, so the journey is skipped.
describe('Phase 1 forced-upgrade probe (platform MIN_CLI_VERSION raised for this run)', { skip: SKIP || (EXPECT_426 === '' ? 'REVITION_E2E_EXPECT_426 not set' : false) }, () => {
  it('[CLI-T1.6.1-AC1] a CLI below the platform minimum exits 10 with the platform message and `revition upgrade`', async () => {
    const r = await cli(['whoami']);
    assert.equal(r.code, 10, r.stderr);
    // The platform's 426 message (REVITION-CLI-PLAN T1.2.5): "Revition CLI <v> is no longer supported. Run: ...".
    assert.match(r.stderr, /Revition CLI \S+ is no longer supported/);
    assert.match(r.stderr, /revition upgrade/);
    const json = await cli(['whoami', '--json']);
    assert.equal(json.code, 10);
    assert.equal((JSON.parse(json.stdout) as { error: { code: string } }).error.code, 'CLI_UPGRADE_REQUIRED');
    assert.equal(captured.join('\n').includes(TOKEN), false, 'the token value was printed');
  });
});

describe('Phase 1 journey (automated, CI token)', { skip: SKIP || (EXPECT_426 !== '' ? 'the 426 probe run' : false) }, () => {
  let ownTokenId = '';

  it('[CLI-T1.6.1-AC1] whoami -> auth status -> doctor succeed with a PAT (CI path)', async () => {
    const who = await cli(['whoami', '--json']);
    assert.equal(who.code, 0, who.stderr);
    const me = json<{ user: string; method: string; host: string }>(who);
    assert.equal(typeof me.user, 'string');
    assert.deepEqual([me.method, me.host], ['token', HOST]);
    const status = await cli(['auth', 'status', '--json']);
    assert.equal(status.code, 0, status.stderr);
    const doctor = await cli(['doctor', '--json']);
    assert.equal(doctor.code, 0, doctor.stderr);
  });

  it('[CLI-T1.6.1-AC1] token list shows prefixes only; token create with a CI token is refused (exit 4)', async () => {
    const list = await cli(['token', 'list', '--json']);
    assert.equal(list.code, 0, list.stderr);
    const tokens = json<{ tokens: Array<{ tokenId: string; prefix: string; revokedAt: string | null }> }>(list).tokens;
    const own = tokens.find((t) => t.revokedAt === null && TOKEN.startsWith(t.prefix));
    assert.ok(own !== undefined, 'the journey token is listed (by prefix)');
    ownTokenId = own.tokenId;
    const create = await cli(['token', 'create', '--name', 'phase1-e2e', '--yes', '--json']);
    assert.equal(create.code, 4, create.stderr);
  });

  it('[CLI-T1.6.1-AC1] revoke -> the next call exits 3 within 60 s; logout leaves nothing behind', async () => {
    assert.notEqual(ownTokenId, '', 'the token id from token list');
    const revoke = await cli(['token', 'revoke', ownTokenId, '--yes', '--json']);
    assert.equal(revoke.code, 0, revoke.stderr);
    const deadline = Date.now() + 60_000;
    let after: Run = await cli(['whoami']);
    while (after.code !== 3 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      after = await cli(['whoami']);
    }
    assert.equal(after.code, 3, after.stderr);
    const logout = await cli(['logout']);
    assert.ok(logout.code === 0, logout.stderr);
  });

  it('[CLI-T1.6.1-AC1] leak suite: the token appears in no captured output and in no CLI file', () => {
    const all = captured.join('\n');
    assert.equal(all.includes(TOKEN), false, 'the token value was printed');
    for (const f of Object.values(DIRS).flatMap((d) => filesUnder(d))) {
      assert.equal(readFileSync(f, 'utf8').includes(TOKEN), false, `the token is stored in ${f}`);
    }
  });
});
