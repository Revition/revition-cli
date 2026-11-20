import {
  atomicWriteFile,
  defaultCliPaths,
  loadUserConfig,
  resetInstallId,
  RevitionCommand,
  setConfigValue,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

interface Out {
  readonly config: 'off';
  readonly installIdReset: boolean;
}

export default class TelemetryDisable extends RevitionCommand<Out> {
  static override summary = 'Opt out of telemetry: nothing more is sent, and the install id is reset.';
  static override examples = ['revition telemetry disable'];
  static meta: CommandMeta = {
    id: 'telemetry:disable',
    summary: TelemetryDisable.summary,
    examples: TelemetryDisable.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.telemetry.disable.v1',
    stability: 'stable',
  };

  protected async run2(_ctx: CommandContext): Promise<Out> {
    const paths = defaultCliPaths();
    const { config } = await loadUserConfig(paths.configFile);
    await atomicWriteFile(paths.configFile, `${JSON.stringify(setConfigValue(config, 'telemetry', 'off'), null, 2)}\n`);
    // Opted in, then out: the install id is reset and anything still queued is dropped (T1.4.2 edge case).
    await resetInstallId(paths.stateDir);
    return { config: 'off', installIdReset: true };
  }

  protected override human(_d: Out): HumanView {
    return { text: 'Telemetry disabled; the install id was reset.\n' };
  }
}
