import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertConformsToSchema } from './json-conformance.js';

/**
 * The real CLI shell (with this plugin installed through its oclif.plugins). L3 (REVITION-CLI-PLAN.md:3265): the
 * packed-install job sets REVITION_L3_BIN to the INSTALLED `revition` bin, so these suites drive the shipped artifact.
 */
export const CLI_BIN = process.env['REVITION_L3_BIN'] ?? fileURLToPath(new URL('../../../../packages/cli/bin/run', import.meta.url));
export const PAT = `rvt_${'P'.repeat(40)}`;
const BASE = '/api/v1/foundry';

export interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly query: string;
  readonly body: unknown;
  /** The request's Idempotency-Key (mutations), so a test can see that a retry re-sends the same one. */
  readonly idempotencyKey?: string;
}

export type Answer = { readonly status: number; readonly body: unknown } | null;
/** One route table: method + Dev API path (without the Foundry base) -> answer; null = 404. */
export type Routes = (method: string, path: string, body: unknown, query: URLSearchParams) => Answer | Promise<Answer>;

export interface MockPlatform {
  readonly host: string;
  readonly log: Recorded[];
  close(): void;
}

export async function startMockPlatform(routes: Routes): Promise<MockPlatform> {
  const log: Recorded[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void (async (): Promise<void> => {
        const url = new URL(req.url ?? '/', 'http://x');
        const text = Buffer.concat(chunks).toString('utf8');
        const body = text === '' ? null : (JSON.parse(text) as unknown);
        const path = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : url.pathname;
        const idem = req.headers['idempotency-key'];
        log.push({ method: req.method ?? 'GET', path, query: url.search, body, ...(typeof idem === 'string' ? { idempotencyKey: idem } : {}) });
        const auth = String(req.headers['authorization'] ?? '');
        const a: Answer = !auth.startsWith('Bearer rvt_')
          ? { status: 401, body: { error: { code: 'CLI_SIGN_IN_REQUIRED', message: 'sign in' } } }
          : await routes(req.method ?? 'GET', path, body, url.searchParams);
        const out = a ?? { status: 404, body: { error: { code: 'AGENT_NOT_FOUND', message: 'not found' } } };
        res.writeHead(out.status, { 'content-type': 'application/json' }).end(JSON.stringify(out.body));
      })();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    host: `127.0.0.1:${(server.address() as AddressInfo).port}`,
    log,
    close: () => {
      server.close();
      server.closeAllConnections();
    },
  };
}

export const ok = (body: unknown): Answer => ({ status: 200, body });
export const err = (status: number, code: string, message: string): Answer => ({ status, body: { error: { code, message } } });

export interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Isolated XDG dirs for one test. */
export async function dirs(): Promise<Record<string, string>> {
  const root = await mkdtemp(join(tmpdir(), 'revdev-'));
  return { XDG_CONFIG_HOME: join(root, 'config'), XDG_STATE_HOME: join(root, 'state'), XDG_CACHE_HOME: join(root, 'cache') };
}

/** Runs the real CLI in `cwd` against the mock (a PAT, so no keychain is touched); stdin is not a TTY. */
export function runCli(
  args: readonly string[],
  opts: { readonly cwd: string; readonly host: string; readonly env?: Record<string, string>; readonly input?: string }
): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_BIN, ...args], {
      cwd: opts.cwd,
      env: { ...process.env, NO_COLOR: '1', REVITION_NO_UPDATE_CHECK: '1', REVITION_HOST: opts.host, REVITION_TOKEN: PAT, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      // T3.2.1 AC1: every successful --json document conforms to its published schema.
      if (args.includes('--json') && code === 0) {
        try {
          assertConformsToSchema(stdout);
        } catch (e) {
          reject(e as Error);
          return;
        }
      }
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(opts.input ?? '');
  });
}
