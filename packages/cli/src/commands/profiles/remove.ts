import { Args } from '@oclif/core';
import {
  atomicWriteFile,
  defaultCliPaths,
  loadUserConfig,
  logoutAndQueue,
  RevitionCommand,
  UserConfigSchema,
  usageError,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

import { logoutDeps, storeFor } from '../../runtime.js';

interface Out {
  readonly removed: string;
  readonly signedOut: boolean;
}

export default class ProfilesRemove extends RevitionCommand<Out> {
  static override summary = 'Remove a profile: sign it out (revoking its session) and delete its settings.';
  static override examples = ['revition profiles remove old-account --yes'];
  static meta: CommandMeta = {
    id: 'profiles:remove',
    summary: ProfilesRemove.summary,
    examples: ProfilesRemove.examples,
    requiredScopes: [],
    mutates: true,
    confirm: 'typed',
    jsonSchemaId: 'revition.profiles.remove.v1',
    stability: 'stable',
  };
  static override args = { name: Args.string({ required: true, description: 'The profile.' }) };

  protected override confirmTarget(ctx: CommandContext): string | null {
    return String(ctx.args['name']);
  }

  protected async run2(ctx: CommandContext): Promise<Out> {
    const name = String(ctx.args['name']);
    const paths = defaultCliPaths();
    const { config } = await loadUserConfig(paths.configFile);
    const profile = config.profiles[name];
    if (profile === undefined && name !== 'default') throw usageError('PROFILE_UNKNOWN', `There is no profile "${name}".`);
    const host = profile?.host ?? 'api.revition.com';
    const signedOut = await storeFor(ctx, name, paths.stateDir)
      .then(async (store) => (await logoutAndQueue({ profile: name, host }, logoutDeps(store, host, ctx.env, ctx.cliVersion), paths.stateDir)).hadSession)
      .catch(() => false);
    const profiles = { ...config.profiles };
    delete profiles[name];
    const next = UserConfigSchema.parse({ ...config, profiles, defaultProfile: config.defaultProfile === name ? 'default' : config.defaultProfile });
    await atomicWriteFile(paths.configFile, `${JSON.stringify(next, null, 2)}\n`);
    return { removed: name, signedOut };
  }

  protected override human(d: Out): HumanView {
    return { text: `Removed profile ${d.removed}${d.signedOut ? ' (signed out)' : ''}.\n` };
  }
}
