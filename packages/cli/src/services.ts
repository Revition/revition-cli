import {
  actingBanner,
  ApiClient,
  CLI_SCOPES,
  defaultCliPaths,
  loadProjectFile,
  loadUserConfig,
  patFromEnv,
  resolveSettings,
  selectStore,
  type CoreServices,
  type DeveloperMe,
} from '@revition/cli-core';

import { featureFromCache, recordRun } from './telemetry-flags.js';

/**
 * The services the core pipeline uses in the real CLI: the profile from config, the signed-in state from REVITION_TOKEN
 * or the credential store (never reading a secret into output), the acting banner for mutating commands. The client
 * scope check is an early, clear error only: the server re-checks every call, so a known credential reports all scopes
 * and the platform answers 403 for anything outside the credential's real scopes.
 */
async function where(profileFlag: string | undefined): Promise<{ profile: string; host: string; stateDir: string }> {
  const paths = defaultCliPaths();
  const { config } = await loadUserConfig(paths.configFile);
  const project = await loadProjectFile(process.cwd()).catch(() => null);
  const s = resolveSettings({ flags: { profile: profileFlag }, env: process.env, project: project?.project ?? null, user: config });
  return { profile: s.profile.value, host: s.host.value, stateDir: paths.stateDir };
}

const noPassphrase = async (): Promise<string> => {
  throw new Error('no passphrase in a preflight');
};

export function cliServices(cliVersion: string): CoreServices {
  return {
    loadProfile: async (p) => ({ name: (await where(p)).profile }),
    resolveAuth: async (profile) => {
      if (patFromEnv(process.env) !== null) return { scopes: CLI_SCOPES };
      const w = await where(profile);
      try {
        const store = await selectStore({ profile, stateDir: w.stateDir, env: process.env, insecureStorageFlag: false, askPassphrase: noPassphrase });
        if (store.backend === 'encrypted-file') return { scopes: CLI_SCOPES }; // known only after the passphrase; the command asks
        return (await store.get({ profile, host: w.host })) === null ? null : { scopes: CLI_SCOPES };
      } catch {
        return null;
      }
    },
    featureEnabled: async (name, profile) => featureFromCache(name, profile, cliVersion),
    afterRun: async (run) => recordRun({ ...run, version: cliVersion }),
    actingBanner: async (profile) => {
      const w = await where(profile);
      const pat = patFromEnv(process.env);
      let email: string | null = null;
      let token: string | null = pat;
      if (token === null) {
        const store = await selectStore({ profile, stateDir: w.stateDir, env: process.env, insecureStorageFlag: false, askPassphrase: noPassphrase });
        const c = await store.get({ profile, host: w.host });
        if (c === null) return null;
        email = c.email;
        token = c.credential;
      }
      const t = token;
      const me = (await new ApiClient({ host: w.host, token: async () => t, cliVersion, retries: 0, timeoutMs: 5_000 }).request<DeveloperMe>({ method: 'GET', path: '/dev/me' })).body;
      return actingBanner({
        user: email ?? me.identityRef,
        workspace: me.kind === 'tenant_member' ? me.linkedOrgId : null,
        host: w.host,
      });
    },
  };
}
