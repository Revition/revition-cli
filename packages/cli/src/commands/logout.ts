import { Flags } from '@oclif/core';
import {
  defaultCliPaths,
  loadUserConfig,
  logoutAndQueue,
  RevitionCommand,
  type CommandContext,
  type CommandMeta,
  type HumanView,
  type LogoutResult,
} from '@revition/cli-core';

import { logoutDeps, runtime, storeFor } from '../runtime.js';

interface Out {
  readonly results: readonly LogoutResult[];
}

export default class Logout extends RevitionCommand<Out> {
  static override summary = 'Sign out: revoke the session on Auth0 and the platform, and delete the local credential.';
  static override examples = ['revition logout', 'revition logout --all'];
  static meta: CommandMeta = {
    id: 'logout',
    summary: Logout.summary,
    examples: Logout.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.logout.v1',
    stability: 'stable',
  };
  static override flags = { all: Flags.boolean({ description: 'Sign out of every profile.' }) };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const rt = await runtime(ctx);
    if (rt.store === null) return { results: [{ profile: rt.profile, host: rt.host, hadSession: false, auth0Revoked: false, sessionRevoked: false, queued: false }] };
    const targets: Array<{ profile: string; host: string }> = [{ profile: rt.profile, host: rt.host }];
    if (ctx.commandFlags['all'] === true) {
      const { config } = await loadUserConfig(defaultCliPaths().configFile);
      for (const [name, p] of Object.entries(config.profiles)) {
        if (!targets.some((t) => t.profile === name && t.host === p.host)) targets.push({ profile: name, host: p.host });
      }
    }
    const results: LogoutResult[] = [];
    for (const t of targets) {
      const store = t.profile === rt.profile ? rt.store : await storeFor(ctx, t.profile, rt.paths.stateDir);
      results.push(await logoutAndQueue(t, logoutDeps(store, t.host, ctx.env, ctx.cliVersion), rt.paths.stateDir));
    }
    return { results };
  }

  protected override human(d: Out): HumanView {
    return {
      text: d.results
        .map((r) =>
          !r.hadSession
            ? `${r.profile}@${r.host}: nothing to do (not signed in).`
            : r.queued
              ? `${r.profile}@${r.host}: signed out locally; the server revoke is queued (offline) and retried at the next run.`
              : `${r.profile}@${r.host}: signed out (Auth0 and platform sessions revoked, local credential deleted).`
        )
        .join('\n')
        .concat('\n'),
    };
  }
}
