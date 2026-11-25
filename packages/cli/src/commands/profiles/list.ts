import { defaultCliPaths, loadUserConfig, RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

interface Out {
  readonly defaultProfile: string;
  readonly profiles: ReadonlyArray<{ readonly name: string; readonly host: string; readonly authMethod: string; readonly isDefault: boolean }>;
}

export default class ProfilesList extends RevitionCommand<Out> {
  static override summary = 'List the configured profiles (each is one account on one host).';
  static override examples = ['revition profiles list'];
  static meta: CommandMeta = {
    id: 'profiles:list',
    summary: ProfilesList.summary,
    examples: ProfilesList.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.profiles.list.v1',
    stability: 'stable',
  };

  protected async run2(_ctx: CommandContext): Promise<Out> {
    const { config } = await loadUserConfig(defaultCliPaths().configFile);
    const names = new Set(['default', ...Object.keys(config.profiles)]);
    return {
      defaultProfile: config.defaultProfile,
      profiles: [...names].sort().map((name) => {
        const p = config.profiles[name];
        return { name, host: p?.host ?? 'api.revition.com', authMethod: p?.authMethod ?? 'browser', isDefault: name === config.defaultProfile };
      }),
    };
  }

  protected override human(d: Out): HumanView {
    return { text: d.profiles.map((p) => `${p.isDefault ? '*' : ' '} ${p.name.padEnd(14)} ${p.host}`).join('\n').concat('\n') };
  }
}
