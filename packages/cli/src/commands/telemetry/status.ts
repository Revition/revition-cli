import {
  defaultCliPaths,
  loadUserConfig,
  RevitionCommand,
  telemetryEnabled,
  TELEMETRY_DOCS_URL,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

interface Out {
  readonly enabled: boolean;
  readonly config: string;
  readonly overriddenByEnv: string | null;
  readonly docs: string;
}

export default class TelemetryStatus extends RevitionCommand<Out> {
  static override summary = 'Show whether anonymous usage telemetry is on, and why.';
  static override examples = ['revition telemetry status'];
  static meta: CommandMeta = {
    id: 'telemetry:status',
    summary: TelemetryStatus.summary,
    examples: TelemetryStatus.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.telemetry.status.v1',
    stability: 'stable',
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const { config } = await loadUserConfig(defaultCliPaths().configFile);
    const enabled = telemetryEnabled(ctx.env, config.telemetry);
    const dnt = ctx.env['DO_NOT_TRACK'];
    const env = dnt !== undefined && dnt !== '' && dnt !== '0' ? 'DO_NOT_TRACK' : /^(0|off|false)$/i.test(ctx.env['REVITION_TELEMETRY'] ?? '') ? 'REVITION_TELEMETRY' : null;
    return { enabled, config: config.telemetry, overriddenByEnv: env, docs: TELEMETRY_DOCS_URL };
  }

  protected override human(d: Out): HumanView {
    return {
      text: `Telemetry is ${d.enabled ? 'on' : 'off'} (config: ${d.config}${d.overriddenByEnv === null ? '' : `; ${d.overriddenByEnv} turns it off`}). What is collected: ${d.docs}\n`,
    };
  }
}
