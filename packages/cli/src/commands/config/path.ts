import {
  defaultCliPaths,
  RevitionCommand,
  type CliPaths,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

export default class ConfigPath extends RevitionCommand<CliPaths> {
  static override summary = 'Print where the CLI keeps its config, state and cache.';
  static override examples = ['revition config path'];
  static meta: CommandMeta = {
    id: 'config:path',
    summary: ConfigPath.summary,
    examples: ConfigPath.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.config.path.v1',
    stability: 'stable',
  };

  protected async run2(_ctx: CommandContext): Promise<CliPaths> {
    return defaultCliPaths();
  }

  protected override human(data: CliPaths): HumanView {
    return { text: `${data.configFile}\n` };
  }
}
