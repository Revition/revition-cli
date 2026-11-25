import { mkdtemp } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/** The real CLI shell (plugin-mcp is installed through its oclif.plugins). */
export const CLI_BIN = fileURLToPath(new URL('../../../../packages/cli/bin/run', import.meta.url));
export const CLI_ROOT = fileURLToPath(new URL('../../../../packages/cli', import.meta.url));
export const PAT = `rvt_${'M'.repeat(40)}`;
const BASE = '/api/v1/foundry';

export interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly client: string | undefined;
}

export type Answer = { readonly status: number; readonly body: unknown } | null;
export type Routes = (method: string, path: string, body: unknown) => Answer;

export interface MockPlatform {
  readonly host: string;
  readonly log: Recorded[];
  close(): void;
}

/** A platform that answers `routes` (paths without the Foundry base) for a Bearer PAT, and logs every call. */
export async function startMockPlatform(routes: Routes): Promise<MockPlatform> {
  const log: Recorded[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x');
      const text = Buffer.concat(chunks).toString('utf8');
      const body = text === '' ? null : (JSON.parse(text) as unknown);
      const path = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : url.pathname;
      const client = req.headers['revition-client'];
      log.push({ method: req.method ?? 'GET', path, body, client: typeof client === 'string' ? client : undefined });
      const a = String(req.headers['authorization'] ?? '').startsWith('Bearer rvt_')
        ? routes(req.method ?? 'GET', path, body)
        : { status: 401, body: { error: { code: 'CLI_SIGN_IN_REQUIRED', message: 'sign in' } } };
      const out = a ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'not found' } } };
      res.writeHead(out.status, { 'content-type': 'application/json' }).end(JSON.stringify(out.body));
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

/**
 * How long a test waits for the server's `initialize` answer. The SDK's default is 60 s; on windows-latest the server
 * DID answer (two conformance tests passed at 72 s and 120 s) but a cold `revition mcp serve` under the parallel suite
 * (pnpm -r + node --test file concurrency on a 4-vCPU runner) took longer than 60 s, so `initialize` timed out with
 * -32001. Windows gets 180 s; every other OS keeps the SDK default. An exported constant so the raw test uses the same.
 */
export const INITIALIZE_TIMEOUT_MS = process.platform === 'win32' ? 180_000 : 60_000;

/** An MCP client (the official SDK) connected to `revition mcp serve <flags>` under a PAT against `host`. */
export async function connect(host: string, flags: readonly string[] = []): Promise<{ client: Client; close: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'revmcp-'));
  const env: Record<string, string> = {
    PATH: process.env['PATH'] ?? '',
    HOME: root,
    XDG_CONFIG_HOME: join(root, 'c'),
    XDG_STATE_HOME: join(root, 's'),
    XDG_CACHE_HOME: join(root, 'k'),
    REVITION_HOST: host,
    REVITION_TOKEN: PAT,
    REVITION_NO_UPDATE_CHECK: '1',
  };
  const transport = new StdioClientTransport({ command: process.execPath, args: [CLI_BIN, 'mcp', 'serve', ...flags], env, stderr: 'pipe' });
  // The server's stderr is kept: when it never answers (windows-latest CI: initialize timed out, no stdout at all), the
  // failure carries what the server printed, so the run names where it stopped instead of a bare -32001.
  let stderr = '';
  transport.stderr?.on('data', (c: Buffer) => {
    stderr += c.toString('utf8');
  });
  const client = new Client({ name: 'revition-mcp-test', version: '0.0.0' });
  try {
    await client.connect(transport, { timeout: INITIALIZE_TIMEOUT_MS });
  } catch (e) {
    await transport.close().catch(() => undefined);
    throw new Error(`${e instanceof Error ? e.message : String(e)}; server stderr: ${stderr === '' ? '(none)' : stderr}`, { cause: e });
  }
  return { client, close: () => client.close() };
}
