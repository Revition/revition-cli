import { hostname } from 'node:os';

import { Flags } from '@oclif/core';
import {
  ApiClient,
  assertPatShape,
  authConfigFor,
  authorizeUrl,
  canOpenBrowser,
  CLI_SCOPES,
  createSession,
  defaultCliPaths,
  deviceTokenAttempt,
  deviceWarning,
  exchangeCode,
  fetchJwks,
  loadProjectFile,
  loadUserConfig,
  newDeviceKey,
  newPkce,
  openBrowser,
  pollForTokens,
  readTokenFromStdin,
  requestDeviceCode,
  resolveSettings,
  RevitionCliError,
  RevitionCommand,
  SESSIONS_PAGE_URL,
  startLoopback,
  usageError,
  verifyIdToken,
  type CliScope,
  type CommandContext,
  type CommandMeta,
  type HumanView,
  type TokenSet,
} from '@revition/cli-core';

import { storeFor } from '../runtime.js';

interface Out {
  readonly user: string;
  readonly workspace: string | null;
  readonly host: string;
  readonly profile: string;
  readonly sessionId: string | null;
  readonly method: 'browser' | 'device' | 'token';
  readonly backend: string | null;
  readonly portalUrl: string;
  readonly note: string | null;
}

export const PORTAL_SESSIONS_URL = SESSIONS_PAGE_URL;

export default class Login extends RevitionCommand<Out> {
  static override summary = 'Sign in (browser by default; --device for remote shells; --with-token to check a CI token).';
  static override examples = ['revition login', 'revition login --device', 'revition login --with-token < token.txt'];
  static meta: CommandMeta = {
    id: 'login',
    summary: Login.summary,
    examples: Login.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.login.v1',
    stability: 'stable',
  };
  static override flags = {
    device: Flags.boolean({ description: 'Use the device-code flow (opt-in; for machines without a browser).' }),
    force: Flags.boolean({ description: 'Ask the identity provider to sign in again (prompt=login).' }),
    scopes: Flags.string({ description: 'Comma-separated CLI scopes for the session (default: all).' }),
    'insecure-storage': Flags.boolean({ description: 'Without an OS keychain: keep an encrypted file (passphrase each session).' }),
    'with-token': Flags.boolean({ description: 'Read a token from stdin and check it (tokens are never stored).' }),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const f = ctx.commandFlags;
    const paths = defaultCliPaths();
    const { config } = await loadUserConfig(paths.configFile);
    const project = await loadProjectFile(process.cwd());
    const settings = resolveSettings({ flags: { profile: ctx.flags.profile }, env: ctx.env, project: project?.project ?? null, user: config });
    const profile = settings.profile.value;
    const host = settings.host.value;
    if (f['with-token'] === true) return withToken(ctx, host, profile);
    const device = f['device'] === true;
    // T1.3.1 invariant: --json login only on the non-interactive device path (--no-input + --device).
    if (ctx.flags.json && !(ctx.flags.noInput && device)) {
      throw usageError('LOGIN_JSON_REFUSED', '--json login needs --no-input and --device.', 'In CI use REVITION_TOKEN instead of a login.');
    }
    const scopes = parseScopes(f['scopes']);
    // T1.3.3: the store is chosen BEFORE any sign-in; no keychain (and no --insecure-storage) refuses here and nothing
    // is written anywhere.
    const store = await storeFor(ctx, profile, paths.stateDir, f['insecure-storage'] === true);
    const cfg = authConfigFor(host, ctx.env);
    const nowSec = (): number => Math.floor(Date.now() / 1000);
    let tokens: TokenSet;
    let nonce: string | null = null;
    if (device) {
      const code = await requestDeviceCode(cfg, ctx.env);
      ctx.io.err(deviceWarning(code, hostname()));
      ctx.io.flush();
      tokens = await pollForTokens(code, { sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: Date.now, attempt: deviceTokenAttempt(cfg, code.deviceCode, ctx.env) });
    } else {
      const pkce = newPkce();
      nonce = pkce.nonce;
      const listener = await startLoopback(pkce.state);
      const url = authorizeUrl(cfg, { redirectUri: listener.redirectUri, challenge: pkce.challenge, state: pkce.state, nonce: pkce.nonce, force: f['force'] === true });
      const opened = canOpenBrowser(ctx.env, process.platform) && (await openBrowser(url));
      ctx.io.err(
        opened
          ? 'Opening your browser to sign in. Auth0 asks you to confirm the sign-in for the Revition CLI: that screen is expected.\n'
          : `Open this link to sign in:\n${url}\nOn a remote shell, use \`revition login --device\` instead.\n`
      );
      ctx.io.flush();
      const authCode = await listener.code;
      tokens = await exchangeCode(cfg, { code: authCode, verifier: pkce.verifier, redirectUri: listener.redirectUri }, ctx.env);
    }
    if (tokens.idToken === null || tokens.refreshToken === null) {
      throw new RevitionCliError({ code: 'LOGIN_INCOMPLETE', message: 'The sign-in returned no identity or refresh token.' }, 3);
    }
    const claims = verifyIdToken(tokens.idToken, { jwks: await fetchJwks(cfg, ctx.env), cfg, nonce, nowSec: nowSec() });
    const key = newDeviceKey();
    const auth0Access = tokens.accessToken;
    const exchange = new ApiClient({ host, token: async () => auth0Access, cliVersion: ctx.cliVersion, retries: 1 }, { env: ctx.env });
    const session = await createSession(exchange, { scopes, devicePublicKey: key.publicKey, cliVersion: ctx.cliVersion });
    const email = typeof claims['email'] === 'string' ? claims['email'] : null;
    await store.set(
      { profile, host },
      {
        credential: session.credential,
        auth0RefreshToken: tokens.refreshToken,
        devicePrivateKey: key.privateKey,
        sessionId: session.sessionId,
        authFreshUntil: session.authFreshUntil,
        method: device ? 'device' : 'browser',
        email,
      }
    );
    // The Auth0 access token and id_token are discarded here: only the platform session is kept.
    const me = await new ApiClient({ host, token: async () => session.credential, cliVersion: ctx.cliVersion }, { env: ctx.env })
      .request<{ kind?: string; linkedOrgId?: string | null }>({ method: 'GET', path: '/dev/me' })
      .then((r) => r.body)
      .catch(() => null);
    return {
      user: email ?? String(claims['sub'] ?? 'unknown'),
      workspace: me?.kind === 'tenant_member' ? (me.linkedOrgId ?? null) : null,
      host,
      profile,
      sessionId: session.sessionId,
      method: device ? 'device' : 'browser',
      backend: store.backend,
      portalUrl: PORTAL_SESSIONS_URL,
      note: null,
    };
  }

  protected override human(d: Out): HumanView {
    if (d.method === 'token') return { text: `${d.note ?? ''}\n` };
    return {
      text: `Logged in as ${d.user} (${d.workspace ?? 'developer account'}) on ${d.host}. Session ${d.sessionId} - manage at ${d.portalUrl}\n`,
    };
  }
}

function parseScopes(raw: unknown): readonly CliScope[] | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const list = raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
  const bad = list.filter((s) => !(CLI_SCOPES as readonly string[]).includes(s));
  if (bad.length > 0) throw usageError('UNKNOWN_SCOPE', `Unknown scope: ${bad.join(', ')}.`, `Scopes: ${CLI_SCOPES.join(', ')}.`);
  return list as CliScope[];
}

/** T1.3.6: `--with-token` reads stdin only, checks the token against the platform, and stores NOTHING. */
async function withToken(ctx: CommandContext, host: string, profile: string): Promise<Out> {
  const token = assertPatShape(await readTokenFromStdin(process.stdin));
  const client = new ApiClient({ host, token: async () => token, cliVersion: ctx.cliVersion }, { env: ctx.env });
  const me = (await client.request<{ identityRef?: string; kind?: string; linkedOrgId?: string | null }>({ method: 'GET', path: '/dev/me' })).body;
  return {
    user: String(me.identityRef ?? 'unknown'),
    workspace: me.kind === 'tenant_member' ? (me.linkedOrgId ?? null) : null,
    host,
    profile,
    sessionId: null,
    method: 'token',
    backend: null,
    portalUrl: PORTAL_SESSIONS_URL,
    note: `The token is valid for ${String(me.identityRef ?? 'this account')} on ${host}. The CLI never stores tokens: set REVITION_TOKEN for the commands that should use it.`,
  };
}
