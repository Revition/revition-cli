/**
 * The $0 rehearsal of the incident drill (REVITION-CLI-PLAN T1.5.4 AC2/AC3 :1852-1853; T2.5.2 AC2 :2516, "the drill
 * is recorded"), run by node:test, before the live drill on a real canary version and the staging MIN_CLI_VERSION:
 *
 * - Runbook step 1 (docs/release/incident-runbook.md): the REAL `npm` binary runs the runbook's own commands
 *   (`npm dist-tag add @revition/cli@<good> latest`, `npm deprecate @revition/cli@<bad> "<reason>; upgrade to <good>"`,
 *   `npm view @revition/cli dist-tags`) against a stateful scripted registry on 127.0.0.1. The CLI's own update check
 *   (core update/check.ts, T1.4.1) then sees the deprecation and prints the warning; the drill is undone
 *   (`npm deprecate ... ""`, dist-tag back) and the warning goes away.
 * - Runbook step 2.3 (the forced upgrade): the platform's minimum raised above the installed CLI -> every call is 426
 *   and the CLI exits 10 with the platform's message; lowered again -> the same command exits 0.
 *
 * Nothing reaches npmjs.org or staging: the registry and the platform are local, and the only credential is a
 * throwaway token for the local registry in a temporary npmrc.
 *
 *   node --import tsx --test e2e/rehearsal/incident-drill.rehearsal.test.ts
 *   REHEARSAL_OUT=<dir>  also writes the drill record (every command, its exit code and output, the registry's requests).
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { runUpdateCheck, updateNotice } from '../../packages/core/src/update/check.js';

import { startJourneyPlatform } from './journey-platform.js';
import { REHEARSAL_TOKEN } from './run-journey.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT = process.env['REHEARSAL_OUT'] ?? '';
const GOOD = '0.4.0';
const BAD = '0.4.1-canary.0';
const REASON = `drill: canary ${BAD} withdrawn; upgrade to ${GOOD}`;

interface Registry {
  readonly url: string;
  readonly tags: Record<string, string>;
  readonly deprecated: Record<string, string>;
  readonly requests: { method: string; path: string; auth: boolean }[];
  close(): void;
}

/** A stateful npm registry for one package: dist-tags + per-version deprecation, the requests npm and the CLI make. */
async function startRegistry(): Promise<Registry> {
  const tags: Record<string, string> = { latest: BAD, next: BAD };
  const deprecated: Record<string, string> = {};
  const requests: Registry['requests'] = [];
  const versions = [GOOD, BAD];
  const manifest = (v: string, url: string): Record<string, unknown> => ({
    name: '@revition/cli',
    version: v,
    dist: { tarball: `${url}/@revition/cli/-/cli-${v}.tgz`, shasum: '0'.repeat(40) },
    ...(deprecated[v] !== undefined && deprecated[v] !== '' ? { deprecated: deprecated[v] } : {}),
  });
  let url = '';
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d: Buffer) => (raw += d.toString()));
    req.on('end', () => {
      const path = decodeURIComponent((req.url ?? '/').split('?')[0]!).toLowerCase();
      const method = req.method ?? 'GET';
      requests.push({ method, path, auth: String(req.headers['authorization'] ?? '').startsWith('Bearer ') });
      const send = (status: number, body: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      };
      const write = method !== 'GET' && method !== 'HEAD';
      if (write && !String(req.headers['authorization'] ?? '').startsWith('Bearer ')) return send(401, { error: 'auth required' });
      const tag = /^\/-\/package\/@revition\/cli\/dist-tags(?:\/([^/]+))?$/u.exec(path);
      if (tag !== null) {
        if (method === 'GET') return send(200, tags);
        if (method === 'PUT' && tag[1] !== undefined) {
          const v = JSON.parse(raw) as string;
          if (!versions.includes(v)) return send(404, { error: 'no such version' });
          tags[tag[1]] = v;
          return send(201, { ok: true });
        }
      }
      if (path === '/@revition/cli') {
        if (method === 'GET') {
          return send(200, {
            _id: '@revition/cli',
            name: '@revition/cli',
            _rev: '1-drill',
            'dist-tags': tags,
            versions: Object.fromEntries(versions.map((v) => [v, manifest(v, url)])),
          });
        }
        if (method === 'PUT') {
          const doc = JSON.parse(raw) as { versions?: Record<string, { deprecated?: string }> };
          for (const [v, m] of Object.entries(doc.versions ?? {})) {
            // As the npm registry: an empty message un-deprecates (`npm deprecate <pkg>@<v> ""`).
            if (typeof m.deprecated === 'string' && m.deprecated !== '') deprecated[v] = m.deprecated;
            else delete deprecated[v];
          }
          return send(201, { ok: true });
        }
      }
      const one = /^\/@revition\/cli\/([^/]+)$/u.exec(path);
      if (one !== null && method === 'GET' && versions.includes(one[1]!)) return send(200, manifest(one[1]!, url));
      return send(404, { error: 'not found' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, tags, deprecated, requests, close: () => { server.close(); server.closeAllConnections(); } };
}

interface Step {
  readonly cmd: string;
  readonly code: number | null;
  readonly out: string;
}

function sh(cmd: string, args: readonly string[], env: Record<string, string>): Promise<Step> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ cmd: `${cmd === process.execPath ? 'node' : cmd} ${args.join(' ')}`, code, out }));
  });
}

function npmEnv(reg: Registry): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'drill-npm-'));
  const host = reg.url.replace(/^http:/u, '');
  const rc = join(dir, 'npmrc');
  // The ONLY credential in the drill: a throwaway token for the local registry (the live drill uses a maintainer's 2FA).
  writeFileSync(rc, `registry=${reg.url}/\n${host}/:_authToken=drill-local-only\naudit=false\nfund=false\nupdate-notifier=false\n`);
  return { PATH: process.env['PATH'] ?? '', HOME: dir, npm_config_userconfig: rc, npm_config_cache: join(dir, 'cache') };
}

function record(name: string, body: unknown): void {
  if (OUT === '') return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), `${JSON.stringify(body, null, 1)}\n`);
}

describe('dress rehearsal: the incident drill (runbook steps 1 and 2), $0', () => {
  it('[CLI-T1.5.4-AC2] [CLI-T2.5.2-AC2] step 1 on a canary: dist-tag back to good, deprecate the bad one, the CLI warns, then restore', async () => {
    const reg = await startRegistry();
    const steps: Step[] = [];
    try {
      const env = npmEnv(reg);
      const run = async (args: readonly string[]): Promise<Step> => {
        const s = await sh('npm', args, env);
        steps.push(s);
        return s;
      };
      // The runbook's step 1, verbatim with <good> / <bad> / <reason> filled in.
      assert.equal((await run(['dist-tag', 'add', `@revition/cli@${GOOD}`, 'latest'])).code, 0, steps.at(-1)?.out);
      assert.equal((await run(['deprecate', `@revition/cli@${BAD}`, REASON])).code, 0, steps.at(-1)?.out);
      const view = await run(['view', '@revition/cli', 'dist-tags', '--json']);
      assert.equal(view.code, 0, view.out);
      assert.equal((JSON.parse(view.out) as Record<string, string>)['latest'], GOOD, 'latest is back on the good version');
      assert.deepEqual(reg.deprecated, { [BAD]: REASON }, 'only the bad version is deprecated');

      // Users see the warning (T1.4.1): the CLI's own update check against this registry, as the installed bad version.
      const cacheDir = mkdtempSync(join(tmpdir(), 'drill-cache-'));
      const c = await runUpdateCheck({ installedVersion: BAD, cacheDir, env: { npm_config_registry: reg.url }, now: Date.parse('2026-11-19T00:00:00Z') });
      const notice = updateNotice(c, BAD) ?? '';
      assert.match(notice, new RegExp(`warn revition ${BAD.replace(/\./gu, '\\.')} is deprecated: ${REASON.replace(/[.;]/gu, '.')}`, 'u'));

      // Restore (the runbook's undo line), and the warning goes away.
      assert.equal((await run(['deprecate', `@revition/cli@${BAD}`, ''])).code, 0, steps.at(-1)?.out);
      assert.equal((await run(['dist-tag', 'add', `@revition/cli@${BAD}`, 'latest'])).code, 0, steps.at(-1)?.out);
      assert.deepEqual(reg.deprecated, {});
      assert.equal(reg.tags['latest'], BAD);
      const after = await runUpdateCheck({ installedVersion: BAD, cacheDir, env: { npm_config_registry: reg.url }, now: Date.parse('2026-11-19T00:00:00Z') });
      assert.doesNotMatch(updateNotice(after, BAD) ?? '', /deprecated/u);

      // Every write carried the registry credential; none reached another host (the registry saw them all).
      assert.ok(reg.requests.some((r) => r.method === 'PUT' && r.path.endsWith('/dist-tags/latest') && r.auth));
      assert.ok(reg.requests.some((r) => r.method === 'PUT' && r.path === '/@revition/cli' && r.auth));
    } finally {
      reg.close();
      record('incident-drill-step1.json', { good: GOOD, bad: BAD, reason: REASON, steps, registryRequests: reg.requests });
    }
  });

  it('[CLI-T1.5.4-AC3] [CLI-T2.5.2-AC2] step 2.3: MIN_CLI_VERSION raised -> the CLI exits 10 with the platform message; lowered -> exit 0', async () => {
    const bin = join(ROOT, 'packages/cli/bin/run');
    const dir = mkdtempSync(join(tmpdir(), 'drill-min-'));
    const steps: (Step & { readonly min: string | null })[] = [];
    const whoami = async (min: string | null): Promise<Step> => {
      const platform = await startJourneyPlatform(REHEARSAL_TOKEN, min === null ? {} : { minCliVersion: min });
      try {
        const { NODE_TEST_CONTEXT: _p, ...inherited } = process.env;
        const s = await sh(process.execPath, [bin, 'whoami', '--json'], {
          ...(inherited as Record<string, string>),
          REVITION_HOST: platform.host,
          REVITION_TOKEN: REHEARSAL_TOKEN,
          REVITION_NO_UPDATE_CHECK: '1',
          CI: 'true',
          NO_COLOR: '1',
          XDG_CONFIG_HOME: join(dir, 'config'),
          XDG_STATE_HOME: join(dir, 'state'),
          XDG_CACHE_HOME: join(dir, 'cache'),
        });
        steps.push({ ...s, min });
        return s;
      } finally {
        platform.close();
      }
    };
    try {
      const raised = await whoami('99.0.0');
      assert.equal(raised.code, 10, raised.out);
      assert.match(raised.out, /no longer supported/u);
      const lowered = await whoami(null);
      assert.equal(lowered.code, 0, lowered.out);
    } finally {
      record('incident-drill-step2-min-cli-version.json', steps);
    }
  });
});
