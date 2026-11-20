import { Args, Flags } from '@oclif/core';
import {
  atomicWriteFile,
  checkHost,
  defaultCliPaths,
  getConfigValue,
  loadUserConfig,
  RevitionCommand,
  setConfigValue,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

interface Out {
  readonly key: string;
  readonly value: string;
  readonly file: string;
}

export default class ConfigSet extends RevitionCommand<Out> {
  static override summary = 'Set a config value (never a secret).';
  static override examples = [
    'revition config set telemetry off',
    'revition config set profiles.work.host api.revition.com',
  ];
  static meta: CommandMeta = {
    id: 'config:set',
    summary: ConfigSet.summary,
    examples: ConfigSet.examples,
    requiredScopes: [],
    // Local settings only: it changes nothing on the platform, so it needs no confirmation.
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.config.set.v1',
    stability: 'stable',
  };
  static override args = {
    key: Args.string({ required: true, description: 'The config key.' }),
    value: Args.string({ required: true, description: 'The new value.' }),
  };
  static override flags = {
    'allow-custom-host': Flags.boolean({ description: 'Allow a host that is not a Revition host.' }),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const key = String(ctx.args['key']);
    let value = String(ctx.args['value']);
    if (/^profiles\.[^.]+\.host$/.test(key)) {
      const decision = checkHost(value, ctx.commandFlags['allow-custom-host'] === true);
      if (decision.warning !== null) ctx.warn(decision.warning);
      value = decision.host;
    }
    const { configFile } = defaultCliPaths();
    const { config } = await loadUserConfig(configFile);
    const next = setConfigValue(config, key, value);
    await atomicWriteFile(configFile, `${JSON.stringify(next, null, 2)}\n`);
    return { key, value: getConfigValue(next, key) ?? value, file: configFile };
  }

  protected override human(data: Out): HumanView {
    return { text: `${data.key} = ${data.value}\n` };
  }
}
