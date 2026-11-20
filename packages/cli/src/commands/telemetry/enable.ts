import {
  atomicWriteFile,
  defaultCliPaths,
  loadUserConfig,
  RevitionCommand,
  setConfigValue,
  telemetryEnabled,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

interface Out {
  readonly config: 'on';
  readonly effective: boolean;
}

export default class TelemetryEnable extends RevitionCommand<Out> {
  static override summary = 'Opt in to anonymous usage telemetry (DO_NOT_TRACK still wins).';
  static override examples = ['revition telemetry enable'];
  static meta: CommandMeta = {
    id: 'telemetry:enable',
    summary: TelemetryEnable.summary,
    examples: TelemetryEnable.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.telemetry.enable.v1',
    stability: 'stable',
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const { configFile } = defaultCliPaths();
    const { config } = await loadUserConfig(configFile);
    await atomicWriteFile(configFile, `${JSON.stringify(setConfigValue(config, 'telemetry', 'on'), null, 2)}\n`);
    const effective = telemetryEnabled(ctx.env, 'on');
    if (!effective) ctx.warn('DO_NOT_TRACK or REVITION_TELEMETRY is set in this environment, so nothing is sent.');
    return { config: 'on', effective };
  }

  protected override human(d: Out): HumanView {
    return { text: `Telemetry enabled${d.effective ? '' : ' (but turned off by the environment)'}.\n` };
  }
}
