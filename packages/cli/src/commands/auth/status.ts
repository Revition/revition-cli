import {
  defaultCliPaths,
  loadUserConfig,
  patFromEnv,
  RevitionCommand,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

import { storeFor } from '../../runtime.js';

interface ProfileStatus {
  readonly profile: string;
  readonly host: string;
  readonly user: string | null;
  readonly backend: string | null;
  readonly sessionId: string | null;
  readonly authFreshUntil: string | null;
  readonly state: 'signed-in' | 'needs-reauth' | 'signed-out' | 'no-credential-store';
}

interface Out {
  readonly tokenFromEnv: boolean;
  readonly profiles: readonly ProfileStatus[];
}

export default class AuthStatus extends RevitionCommand<Out> {
  static override summary = 'Show every profile: host, user, credential store, session and freshness (never a token).';
  static override examples = ['revition auth status', 'revition auth status --json'];
  static meta: CommandMeta = {
    id: 'auth:status',
    summary: AuthStatus.summary,
    examples: AuthStatus.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.auth.status.v1',
    stability: 'stable',
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const paths = defaultCliPaths();
    const { config } = await loadUserConfig(paths.configFile);
    const entries = Object.entries(config.profiles).map(([profile, p]) => ({ profile, host: p.host }));
    if (!entries.some((e) => e.profile === 'default')) entries.unshift({ profile: 'default', host: 'api.revition.com' });
    const profiles: ProfileStatus[] = [];
    for (const e of entries) {
      try {
        const store = await storeFor(ctx, e.profile, paths.stateDir);
        const c = await store.get(e);
        profiles.push({
          ...e,
          user: c?.email ?? null,
          backend: store.backend,
          sessionId: c?.sessionId ?? null,
          authFreshUntil: c === null ? null : new Date(c.authFreshUntil).toISOString(),
          state: c === null ? 'signed-out' : c.authFreshUntil > Date.now() ? 'signed-in' : 'needs-reauth',
        });
      } catch {
        profiles.push({ ...e, user: null, backend: null, sessionId: null, authFreshUntil: null, state: 'no-credential-store' });
      }
    }
    return { tokenFromEnv: patFromEnv(ctx.env) !== null, profiles };
  }

  protected override human(d: Out): HumanView {
    const lines = d.profiles.map(
      (p) =>
        `${p.profile.padEnd(12)} ${p.host.padEnd(24)} ${p.state.padEnd(20)} ${p.user ?? '-'}  ${p.backend ?? '-'}${p.sessionId === null ? '' : `  session ${p.sessionId}`}`
    );
    if (d.tokenFromEnv) lines.unshift('REVITION_TOKEN is set: commands use it instead of a stored login.');
    return { text: `${lines.join('\n')}\n` };
  }
}
