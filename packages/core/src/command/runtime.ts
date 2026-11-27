import { createSessionClient, type SessionClient } from '../auth/reauth.js';
import { retryQueued, type LogoutDeps } from '../auth/logout.js';
import { authConfigFor, revokeRefreshToken } from '../auth/token-exchange.js';
import { isAllowlistedHost } from '../config/host-allowlist.js';
import { loadProjectFile, loadUserConfig, resolveSettings, type EffectiveSettings } from '../config/load.js';
import { defaultCliPaths, type CliPaths } from '../config/paths.js';
import { PRODUCTION_WEB_LINKS, webLinksFor, type WebLinks } from '../config/web-links.js';
import { selectStore } from '../credentials/select.js';
import type { CredentialStore } from '../credentials/store.js';
import { RevitionCliError, usageError } from '../errors/cli-error.js';
import { ask, canPrompt } from '../output/prompt.js';
import { ApiClient } from '../transport/client.js';

import type { CommandContext } from './context.js';

/**
 * What a networked command needs, resolved once per run: the settings (profile, host), the credential store (null
 * when the machine has none and no PAT is used), and the session client (PAT, stored session, or signed out). Lives in
 * the core so every command, in the shell or in a first-party plugin, signs in the same way.
 */
export interface Runtime {
  readonly settings: EffectiveSettings;
  readonly paths: CliPaths;
  readonly profile: string;
  readonly host: string;
  readonly store: CredentialStore | null;
  readonly session: SessionClient;
  /** Every web link of this profile (plan amendment 2026-11-27, #537): from its `webOrigin`, else production. */
  readonly links: WebLinks;
}

/**
 * The web links of the run's profile, for a command that does not need the full runtime (it opens or prints a page).
 * A config that cannot be read falls back to production links (the command itself reports the config problem).
 */
export async function webLinksOf(ctx: CommandContext): Promise<WebLinks> {
  const paths = defaultCliPaths();
  const loaded = await loadUserConfig(paths.configFile).catch(() => null);
  if (loaded === null) return PRODUCTION_WEB_LINKS;
  const project = await loadProjectFile(process.cwd()).catch(() => null);
  const settings = resolveSettings({ flags: { profile: ctx.flags.profile }, env: ctx.env, project: project?.project ?? null, user: loaded.config });
  return webLinksFor(loaded.config.profiles[settings.profile.value]?.webOrigin);
}

export function passphrasePrompt(ctx: CommandContext): () => Promise<string> {
  return async () => {
    // Entered each session (T1.3.3): never read from the environment, never stored.
    if (!canPrompt(ctx.io, { json: ctx.flags.json, noInput: ctx.flags.noInput })) {
      throw usageError('PASSPHRASE_REQUIRED', 'The encrypted credential file needs its passphrase, and prompts are off.');
    }
    return ask(ctx.io, 'Credential file passphrase:', { hidden: true });
  };
}

export async function storeFor(ctx: CommandContext, profile: string, stateDir: string, insecureStorage = false): Promise<CredentialStore> {
  return selectStore({ profile, stateDir, env: ctx.env, insecureStorageFlag: insecureStorage, askPassphrase: passphrasePrompt(ctx) });
}

export function logoutDeps(store: CredentialStore, host: string, env: Readonly<Record<string, string | undefined>>, cliVersion: string): LogoutDeps {
  return {
    store,
    revokeAuth0: (rt) => revokeRefreshToken(authConfigFor(host, env), rt, env),
    deleteSession: async (sessionId, credential) => {
      const c = new ApiClient({ host, token: async () => credential, cliVersion, retries: 1 }, { env });
      await c.request({ method: 'DELETE', path: `/dev/cli/sessions/${encodeURIComponent(sessionId)}` });
    },
  };
}

export async function runtime(ctx: CommandContext): Promise<Runtime> {
  const paths = defaultCliPaths();
  const { config, warning } = await loadUserConfig(paths.configFile);
  if (warning !== null) ctx.warn(warning);
  const project = await loadProjectFile(process.cwd());
  const settings = resolveSettings({ flags: { profile: ctx.flags.profile }, env: ctx.env, project: project?.project ?? null, user: config });
  const profile = settings.profile.value;
  const host = settings.host.value;
  if (!isAllowlistedHost(host)) ctx.warn(`Using the custom host "${host}" (credentials for it are kept separately).`);
  let store: CredentialStore | null = null;
  try {
    store = await storeFor(ctx, profile, paths.stateDir);
  } catch (e) {
    if (!(e instanceof RevitionCliError) || e.error.code !== 'CREDENTIAL_STORE_UNAVAILABLE') throw e;
  }
  const links = webLinksFor(config.profiles[profile]?.webOrigin);
  const session = await createSessionClient({ profile, host, env: ctx.env, stateDir: paths.stateDir, cliVersion: ctx.cliVersion, store, warn: ctx.warn, links });
  if (store !== null && store.backend === 'keychain') {
    // T1.3.4: an offline logout's queued revocations are retried at the next run (best effort, never blocking).
    await retryQueued(paths.stateDir, logoutDeps(store, host, ctx.env, ctx.cliVersion)).catch(() => 0);
  }
  return { settings, paths, profile, host, store, session, links };
}
