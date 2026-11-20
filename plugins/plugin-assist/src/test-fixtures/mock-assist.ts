import { spawn } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

/** The real CLI entry points (plugin-assist is installed through the CLI's oclif.plugins). */
export const REVITION_BIN = fileURLToPath(new URL('../../../../packages/cli/bin/run', import.meta.url));
export const CORVITO_BIN = fileURLToPath(new URL('../../../../packages/cli/bin/corvito', import.meta.url));
export const PAT = `rvt_${'A'.repeat(40)}`;
const BASE = '/api/v1/foundry';

export interface Seen {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/** A platform with the two assist routes: a fixed session, and scripted turn replies (one per turn). */
export async function startMockAssist(turns: readonly unknown[][]): Promise<{ host: string; seen: Seen[]; close: () => void }> {
  const seen: Seen[] = [];
  let n = 0;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const path = (req.url ?? '/').replace(BASE, '').split('?')[0] ?? '/';
      const text = Buffer.concat(chunks).toString('utf8');
      seen.push({ method: req.method ?? 'GET', path, body: text === '' ? null : (JSON.parse(text) as unknown) });
      const send = (status: number, body: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      };
      if (req.method === 'POST' && path === '/dev/assist/sessions') return send(201, { sessionId: 'as_1', budgetCredits: 5, spentCredits: 0, status: 'open' });
      if (req.method === 'POST' && path === '/dev/assist/sessions/as_1/turns') {
        const events = turns[n] ?? [{ type: 'done', reason: 'no more turns scripted' }];
        n++;
        return send(200, { sessionId: 'as_1', turn: n, status: 'open', events });
      }
      return send(404, { error: { code: 'NOT_FOUND', message: 'not found' } });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    host: `127.0.0.1:${(server.address() as AddressInfo).port}`,
    seen,
    close: () => {
      server.close();
      server.closeAllConnections();
    },
  };
}

/** Runs one entry point (no TTY on stdin) in `cwd` with a PAT against `host`. */
export function runBin(bin: string, args: readonly string[], cwd: string, env: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd, env: { ...process.env, NO_COLOR: '1', REVITION_NO_UPDATE_CHECK: '1', REVITION_TOKEN: PAT, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
