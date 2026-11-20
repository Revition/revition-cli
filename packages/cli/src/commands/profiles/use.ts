import { Args } from '@oclif/core';
import {
  atomicWriteFile,
  defaultCliPaths,
  loadUserConfig,
  RevitionCommand,
  setConfigValue,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

interface Out {
  readonly defaultProfile: string;
}

export default class ProfilesUse extends RevitionCommand<Out> {
  static override summary = 'Make a profile the default (its account and host are used when --profile is not given).';
  static override examples = ['revition profiles use work'];
  static meta: CommandMeta = {
    id: 'profiles:use',
    summary: ProfilesUse.summary,
    examples: ProfilesUse.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.profiles.use.v1',
    stability: 'stable',
  };
  static override args = { name: Args.string({ required: true, description: 'The profile.' }) };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const name = String(ctx.args['name']);
    const { configFile } = defaultCliPaths();
    const { config } = await loadUserConfig(configFile);
    await atomicWriteFile(configFile, `${JSON.stringify(setConfigValue(config, 'defaultProfile', name), null, 2)}\n`);
    return { defaultProfile: name };
  }

  protected override human(d: Out): HumanView {
    return { text: `Default profile: ${d.defaultProfile}\n` };
  }
}
