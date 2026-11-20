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
  readonly key: string;
  readonly file: string;
}

export default class ConfigUnset extends RevitionCommand<Out> {
  static override summary = 'Remove a config value (its default applies again).';
  static override examples = ['revition config unset telemetry'];
  static meta: CommandMeta = {
    id: 'config:unset',
    summary: ConfigUnset.summary,
    examples: ConfigUnset.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.config.unset.v1',
    stability: 'stable',
  };
  static override args = { key: Args.string({ required: true, description: 'The config key.' }) };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const key = String(ctx.args['key']);
    const { configFile } = defaultCliPaths();
    const { config } = await loadUserConfig(configFile);
    await atomicWriteFile(configFile, `${JSON.stringify(setConfigValue(config, key, undefined), null, 2)}\n`);
    return { key, file: configFile };
  }

  protected override human(data: Out): HumanView {
    return { text: `${data.key} unset\n` };
  }
}
