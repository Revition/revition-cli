/**
 * Local development: the Extension SDK with STUBBED ports, so code runs on the developer's machine against nothing
 * real.
 *
 *   - THE SAME SDK. The calls and the permissions each one needs come from the platform's published SDK reference
 *     (`GET /dev/docs/sdk`, generated from the contract), and a call is granted exactly as the platform grants it
 *     (`isGranted`, the same wildcard rule). What a capability holds comes from the platform's own derivation (the
 *     check route's `granted`). A call the capability could not make in the sandbox is refused here too.
 *   - NO PROD DATA, NO LIVE FIRES. Every answer comes from the project's `fixtures.json` (call name -> result). A call
 *     with no fixture is refused with the fix, never invented. `secrets.get` returns a local handle, never a value.
 *     Effects (a reply, a task, a file, an event) are recorded, not performed. Nothing here opens a connection
 *     anywhere but the loopback server the code under test calls.
 *   - THE SAME WIRE. The code reaches it exactly as it reaches the platform in the sandbox: `POST {call, args}` with a
 *     bearer token, answered `{ok, result}` or `{ok: false, error, reason}`.
 */

import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { SdkReference } from './client';

export type Fixtures = Readonly<Record<string, unknown>>;

export type LocalAnswer =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly error: string; readonly reason: string };

export interface LocalCall {
  readonly call: string;
  readonly args: readonly unknown[];
  readonly answer: LocalAnswer;
}

/** The parameter names of one reference signature: `read(sourceId: string, cursor: string | null)` -> both names. */
export function paramNames(signature: string): string[] {
  const open = signature.indexOf('(');
  const names: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of signature.slice(open + 1)) {
    if (depth === 0 && ch === ')') {
      break;
    }
    if (ch === '<' || ch === '(' || ch === '{' || ch === '[') {
      depth += 1;
    } else if (ch === '>' || ch === ')' || ch === '}' || ch === ']') {
      depth -= 1;
    }
    if (depth === 0 && ch === ',') {
      names.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim() !== '') {
    names.push(current);
  }
  return names.map((p) => p.split(':')[0]!.replace('?', '').trim());
}

/** The permissions a call needs with these arguments (the reference writes each argument as `<name>`). */
export function permissionsFor(
  ref: SdkReference,
  call: string,
  args: readonly unknown[]
): readonly string[] | null {
  const entry = ref.namespaces.flatMap((n) => n.calls).find((c) => c.call === call);
  if (entry === undefined) {
    return null;
  }
  const names = paramNames(entry.signature);
  return entry.permissions.map((p) =>
    names.reduce((out, name, i) => out.split(`<${name}>`).join(String(args[i])), p)
  );
}

/** The platform's grant rule: named exactly, or its resource family whole (`source:*`); never an effect by wildcard. */
export function isGranted(granted: readonly string[], p: string): boolean {
  if (granted.includes(p)) {
    return true;
  }
  const colon = p.indexOf(':');
  return colon > 0 && !p.startsWith('effect:') && granted.includes(`${p.slice(0, colon)}:*`);
}

/** The stubbed SDK: every call gated as on the platform, answered only from fixtures, recorded. */
export function localDevPorts(
  ref: SdkReference,
  granted: readonly string[],
  fixtures: Fixtures,
  log: LocalCall[] = []
): (call: string, args: readonly unknown[]) => LocalAnswer {
  const answer = (call: string, args: readonly unknown[]): LocalAnswer => {
    const need = permissionsFor(ref, call, args);
    if (need === null) {
      return { ok: false, error: 'AGENT_FORBIDDEN', reason: 'SDK_UNKNOWN_CALL' };
    }
    const missing = need.filter((p) => !isGranted(granted, p));
    if (missing.length > 0) {
      return {
        ok: false,
        error: 'AGENT_FORBIDDEN',
        reason: `SDK_PERMISSION_DENIED: missing ${missing.join(', ')}`,
      };
    }
    if (call === 'secrets.get') {
      return { ok: true, result: { handle: `local-dev:${String(args[0])}` } };
    }
    if (!Object.prototype.hasOwnProperty.call(fixtures, call)) {
      return {
        ok: false,
        error: 'AGENT_NOT_AVAILABLE',
        reason: `no local fixture for ${call}: add "${call}" to fixtures.json`,
      };
    }
    return { ok: true, result: fixtures[call] ?? null };
  };
  return (call, args) => {
    const a = answer(call, args);
    log.push({ call, args, answer: a });
    return a;
  };
}

export interface LocalSdkServer {
  readonly url: string;
  readonly token: string;
  close(): Promise<void>;
}

function reply(res: ServerResponse, status: number, body: LocalAnswer): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function bodyOf(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) {
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

/** Serve the stubbed SDK on the loopback interface, behind a one-off bearer token. */
export function serveLocalSdk(
  handler: (call: string, args: readonly unknown[]) => LocalAnswer
): Promise<LocalSdkServer> {
  const token = randomBytes(24).toString('hex');
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.headers.authorization !== `Bearer ${token}`) {
      reply(res, 401, { ok: false, error: 'SDK_TOKEN_INVALID', reason: 'not this run' });
      return;
    }
    bodyOf(req).then(
      (b) => {
        const { call, args } = (b ?? {}) as { call?: unknown; args?: unknown };
        const a =
          typeof call === 'string' && Array.isArray(args)
            ? handler(call, args)
            : ({ ok: false, error: 'SDK_BAD_CALL', reason: 'a call is {call, args}' } as const);
        reply(res, a.ok ? 200 : 403, a);
      },
      () => reply(res, 400, { ok: false, error: 'SDK_BAD_CALL', reason: 'the body is not JSON' })
    );
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/sdk`,
        token,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}
