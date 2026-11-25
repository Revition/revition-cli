import {
  defaultCliPaths,
  flattenConfig,
  loadUserConfig,
  RevitionCommand,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

interface Out {
  readonly file: string;
  readonly values: Readonly<Record<string, string>>;
}

export default class ConfigList extends RevitionCommand<Out> {
  static override summary = 'List every config value.';
  static override examples = ['revition config list', 'revition config list --json'];
  static meta: CommandMeta = {
    id: 'config:list',
    summary: ConfigList.summary,
    examples: ConfigList.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.config.list.v1',
    stability: 'stable',
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const { configFile } = defaultCliPaths();
    const { config, warning } = await loadUserConfig(configFile);
    if (warning !== null) ctx.warn(warning);
    return { file: configFile, values: flattenConfig(config) };
  }

  protected override human(data: Out): HumanView {
    return { text: Object.entries(data.values).map(([k, v]) => `${k} = ${v}\n`).join('') };
  }
}
