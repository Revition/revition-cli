import http, { type Server } from 'node:http';

import { RevitionCliError } from '../errors/cli-error.js';
import { EXIT } from '../output/exit-codes.js';

import { safeEqual } from './pkce.js';

/**
 * T1.3.1 steps 2, 4, 5 - the one-shot loopback listener: 127.0.0.1 ONLY (never 0.0.0.0), on the first free port of
 * the registered list (Auth0 has no any-port loopback); exactly ONE good request (GET /callback, Host 127.0.0.1:<p>,
 * the right state, compared in constant time); a bad request gets 400 and the wait continues (3 bad -> abort); 5 min
 * -> exit 3. The page carries no token. The server closes as soon as the code arrives.
 */
export const LOOPBACK_HOST = '127.0.0.1';
export const REGISTERED_PORTS: readonly number[] = [8976, 8977, 8978, 8979, 8980, 8981, 8982, 8983, 8984, 8985];
export const LOGIN_TIMEOUT_MS = 5 * 60_000;
export const MAX_BAD_ATTEMPTS = 3;

export const SUCCESS_PAGE =
  '<!doctype html><meta charset="utf-8"><title>Revition CLI</title>' +
  '<body style="font-family:system-ui;padding:3rem"><h1>Signed in</h1><p>You can close this tab and return to the terminal.</p></body>';
const BAD_PAGE = '<!doctype html><meta charset="utf-8"><title>Revition CLI</title><body><h1>Request refused</h1></body>';

export interface LoopbackListener {
  readonly port: number;
  readonly redirectUri: string;
  /** Resolves with the authorization code once; rejects on timeout, too many bad requests or an IdP error. */
  readonly code: Promise<string>;
  readonly close: () => void;
}

function listenOn(server: Server, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const onError = (): void => {
      server.removeListener('listening', onListening);
      resolve(false);
    };
    const onListening = (): void => {
      server.removeListener('error', onError);
      resolve(true);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, LOOPBACK_HOST);
  });
}

export async function startLoopback(
  state: string,
  opts: { ports?: readonly number[]; timeoutMs?: number } = {}
): Promise<LoopbackListener> {
  const ports = opts.ports ?? REGISTERED_PORTS;
  let settle: { resolve: (c: string) => void; reject: (e: Error) => void } | null = null;
  const code = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject };
  });
  let done = false;
  let bad = 0;
  let port = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${LOOPBACK_HOST}:${port}`);
    const refuse = (): void => {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(BAD_PAGE);
      bad += 1;
      if (bad >= MAX_BAD_ATTEMPTS) finish(new RevitionCliError({ code: 'LOGIN_ABORTED', message: 'Login aborted after repeated invalid callbacks.' }, EXIT.auth));
    };
    if (done || req.method !== 'GET' || url.pathname !== '/callback' || req.headers.host !== `${LOOPBACK_HOST}:${port}`) {
      refuse();
      return;
    }
    const gotState = url.searchParams.get('state') ?? '';
    if (!safeEqual(gotState, state)) {
      refuse();
      return;
    }
    const idpError = url.searchParams.get('error');
    const c = url.searchParams.get('code');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(SUCCESS_PAGE);
    if (idpError !== null || c === null || c === '') {
      finish(new RevitionCliError({ code: 'LOGIN_DENIED', message: `The sign-in was not completed (${idpError ?? 'no code'}).` }, EXIT.auth));
      return;
    }
    finish(null, c);
  });
  const finish = (err: Error | null, c?: string): void => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    server.close();
    server.closeAllConnections();
    if (err !== null) settle?.reject(err);
    else settle?.resolve(c ?? '');
  };
  for (const p of ports) {
    if (await listenOn(server, p)) {
      // The port actually bound (the same as `p` for a registered port; tests may ask for any free one).
      port = (server.address() as { port: number }).port;
      break;
    }
  }
  if (port === 0) {
    throw new RevitionCliError(
      {
        code: 'LOGIN_PORTS_BUSY',
        message: `Every registered login port (${ports[0]}-${ports[ports.length - 1]}) is in use.`,
        hint: 'Close the program using them, or run `revition login --device`.',
      },
      EXIT.auth
    );
  }
  const timer = setTimeout(
    () => finish(new RevitionCliError({ code: 'LOGIN_TIMED_OUT', message: 'login timed out', hint: 'Run `revition login` again.' }, EXIT.auth)),
    opts.timeoutMs ?? LOGIN_TIMEOUT_MS
  );
  timer.unref();
  return { port, redirectUri: `http://${LOOPBACK_HOST}:${port}/callback`, code, close: () => finish(new Error('closed')) };
}
