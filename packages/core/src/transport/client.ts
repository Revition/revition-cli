import { randomUUID } from 'node:crypto';

import type { Dispatcher } from 'undici';

import { undici } from '../lazy-deps.js';
import { assertWorkspaceFor, RevitionCliError } from '../errors/cli-error.js';
import { isWorkspaceRoute } from '../identity/identity.js';
import { mapPlatformError } from '../errors/map-platform-error.js';
import type { DebugLog } from '../log/debug-log.js';
import { EXIT } from '../output/exit-codes.js';

import { clientLabelOf, requestHeaders } from './headers.js';
import { idempotencyKeyFor } from './idempotency.js';
import { dispatcherFor } from './proxy.js';
import { backoffMs, retryAfterMs, shouldRetry } from './retry.js';
import { assertTlsVerificationOn } from './tls-guard.js';

/** T1.1.5 - one hardened way to talk to the platform. */
export interface TransportOptions {
  /** The profile's host (allowlisted, T1.1.2). Tokens go to this host and nowhere else. */
  readonly host: string;
  readonly token: () => Promise<string | null>;
  readonly cliVersion: string;
  /** Default 30 000; streaming endpoints use their own. */
  readonly timeoutMs?: number;
  /** Default 3 for retryable calls. */
  readonly retries?: number;
  /** A non-secret label of the credential (a PAT's 8-character prefix), named when the server refuses it. */
  readonly credentialLabel?: string;
}

export interface TransportDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly random: () => number;
  readonly now: () => number;
  readonly newId: () => string;
  /** One transparent reauth on `401 session_stale` (T1.3.4); returns whether it succeeded. */
  readonly reauth: (() => Promise<boolean>) | null;
  readonly dispatcher: (target: URL) => Dispatcher;
  readonly debugLog: DebugLog | null;
  /** https in production; a test server may use http only through this explicit seam. */
  readonly scheme: 'https' | 'http';
  /** The base path of the CLI contract on the host. */
  readonly basePath: string;
}

export interface ApiRequest {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** A contract path (`/dev/apps`) on the profile host, or an absolute URL (e.g. a presigned upload): no token then. */
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly body?: unknown;
}

export interface ApiResponse<T = unknown> {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: T;
  readonly attempts: number;
}

export function defaultTransportDeps(env: Readonly<Record<string, string | undefined>> = process.env): TransportDeps {
  return {
    env,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    random: Math.random,
    now: Date.now,
    newId: randomUUID,
    reauth: null,
    dispatcher: (target) => dispatcherFor(target, env),
    debugLog: null,
    scheme: 'https',
    basePath: '/api/v1/foundry',
  };
}

/** A loopback host (a local development server): the only place plain http is used. */
export function isLoopbackHost(host: string): boolean {
  const name = host.replace(/:\d+$/, '').toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]';
}

export class ApiClient {
  private readonly deps: TransportDeps;
  /**
   * T1.3.5 AC5 (ruling O106): the session's workspace as GET /dev/me reported it, for this invocation only, in memory.
   * undefined = not known yet (no preflight refusal); null = known to have none.
   */
  private sessionWorkspace: string | null | undefined = undefined;

  constructor(
    private readonly opts: TransportOptions,
    deps: Partial<TransportDeps> = {}
  ) {
    const scheme = deps.scheme ?? (isLoopbackHost(opts.host) ? 'http' : 'https');
    this.deps = { ...defaultTransportDeps(deps.env), ...deps, scheme };
  }

  get knownWorkspace(): string | null | undefined {
    return this.sessionWorkspace;
  }

  /** The URL of a request; `bound` = it goes to the profile host, so it may carry the token. */
  resolve(req: ApiRequest): { readonly url: URL; readonly bound: boolean } {
    const absolute = /^[a-z]+:\/\//i.test(req.path);
    const url = absolute ? new URL(req.path) : new URL(`${this.deps.scheme}://${this.opts.host}${this.deps.basePath}${req.path}`);
    for (const [k, v] of Object.entries(req.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    // Host binding (T09): the token goes only to the exact profile host, over the expected scheme.
    const bound = url.host.toLowerCase() === this.opts.host.toLowerCase() && url.protocol === `${this.deps.scheme}:`;
    return { url, bound };
  }

  async request<T = unknown>(req: ApiRequest): Promise<ApiResponse<T>> {
    assertTlsVerificationOn(this.deps.env);
    const { url, bound } = this.resolve(req);
    const workspaceRoute = bound && isWorkspaceRoute(req.path);
    assertWorkspaceFor(workspaceRoute, this.sessionWorkspace);
    const idempotencyKey = idempotencyKeyFor(req.method, this.deps.newId);
    const maxRetries = this.opts.retries ?? 3;
    let reauthed = false;
    for (let attempt = 0; ; attempt++) {
      const started = this.deps.now();
      const requestId = this.deps.newId();
      const token = bound ? await this.opts.token() : null;
      const headers = requestHeaders({
        cliVersion: this.opts.cliVersion,
        platform: process.platform,
        nodeVersion: process.versions.node,
        requestId,
        accessToken: token,
        idempotencyKey,
        hasBody: req.body !== undefined,
        client: clientLabelOf(this.deps.env),
      });
      let status: number | null = null;
      let resHeaders: Record<string, string | undefined> = {};
      let body: unknown = null;
      let errorCode: string | null = null;
      try {
        const res = await undici().request(url, {
          method: req.method,
          headers,
          ...(req.body === undefined ? {} : { body: JSON.stringify(req.body) }),
          dispatcher: this.deps.dispatcher(url),
          headersTimeout: this.opts.timeoutMs ?? 30_000,
          bodyTimeout: this.opts.timeoutMs ?? 30_000,
        });
        status = res.statusCode;
        resHeaders = Object.fromEntries(
          Object.entries(res.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(', ') : v])
        );
        const text = await res.body.text();
        try {
          body = text === '' ? null : JSON.parse(text);
        } catch {
          body = text;
        }
      } catch (err) {
        errorCode = (err as { code?: string }).code ?? 'NETWORK_ERROR';
        if (isTlsError(errorCode)) {
          throw new RevitionCliError(
            { code: 'TLS_ERROR', message: `The TLS certificate of ${url.host} could not be verified (${errorCode}).`, hint: 'For a corporate CA, set NODE_EXTRA_CA_CERTS.' },
            EXIT.network
          );
        }
      }
      await this.deps.debugLog
        ?.http({ method: req.method, path: url.pathname, status, latencyMs: this.deps.now() - started, traceId: resHeaders['x-trace-id'] ?? requestId })
        .catch(() => undefined);
      if (status !== null && status >= 200 && status < 300) {
        if (bound && req.method === 'GET' && req.path === '/dev/me') {
          const me = body as { kind?: unknown; linkedOrgId?: unknown } | null;
          this.sessionWorkspace = me?.kind === 'tenant_member' && typeof me.linkedOrgId === 'string' ? me.linkedOrgId : null;
        }
        return { status, headers: resHeaders, body: body as T, attempts: attempt + 1 };
      }
      if (status === 401 && !reauthed && authReason(body) === 'session_stale' && this.deps.reauth !== null) {
        reauthed = true;
        if (await this.deps.reauth()) {
          attempt--;
          continue;
        }
      }
      if (attempt < maxRetries && shouldRetry({ method: req.method, status, errorCode, hasIdempotencyKey: idempotencyKey !== null })) {
        const wait = retryAfterMs(resHeaders['retry-after'], this.deps.now()) ?? backoffMs(attempt, this.deps.random);
        await this.deps.sleep(wait);
        continue;
      }
      if (status === null) {
        throw new RevitionCliError(
          { code: 'NETWORK_ERROR', message: `Could not reach ${url.host} (${errorCode ?? 'network error'}).`, hint: 'Check the connection, proxy (HTTPS_PROXY) and host.' },
          EXIT.network
        );
      }
      if (status === 401 && bound && this.opts.credentialLabel !== undefined) {
        throw new RevitionCliError(
          {
            code: 'TOKEN_REFUSED',
            message: `The token ${this.opts.credentialLabel}... was refused (expired or revoked).`,
            hint: 'Create a new token (`revition token create`) and update REVITION_TOKEN.',
            httpStatus: 401,
            traceId: resHeaders['x-trace-id'] ?? null,
          },
          EXIT.auth
        );
      }
      throw mapPlatformError(status, body, resHeaders, { workspaceRoute, sessionWorkspace: this.sessionWorkspace });
    }
  }
}

function authReason(body: unknown): string | null {
  const e = (body as { error?: { code?: unknown; reason?: unknown } } | null)?.error;
  const v = e?.reason ?? e?.code;
  return typeof v === 'string' ? v.toLowerCase() : null;
}

function isTlsError(code: string): boolean {
  return /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|TLS|SSL|ERR_TLS/i.test(code) && !/TIMEOUT/i.test(code);
}
