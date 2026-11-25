import { Args } from '@oclif/core';
import {
  defaultCliPaths,
  getConfigValue,
  loadUserConfig,
  RevitionCommand,
  usageError,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

interface Out {
  readonly key: string;
  readonly value: string;
}

export default class ConfigGet extends RevitionCommand<Out> {
  static override summary = 'Print one config value.';
  static override examples = ['revition config get telemetry', 'revition config get profiles.default.host'];
  static meta: CommandMeta = {
    id: 'config:get',
    summary: ConfigGet.summary,
    examples: ConfigGet.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.config.get.v1',
    stability: 'stable',
  };
  static override args = { key: Args.string({ required: true, description: 'The config key.' }) };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const key = String(ctx.args['key']);
    const { config } = await loadUserConfig(defaultCliPaths().configFile);
    const value = getConfigValue(config, key);
    if (value === null) throw usageError('CONFIG_UNKNOWN_KEY', `"${key}" is not set or not a config key.`);
    return { key, value };
  }

  protected override human(data: Out): HumanView {
    return { text: `${data.value}\n` };
  }
}
