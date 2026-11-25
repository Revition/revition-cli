import {
  defaultCliPaths,
  lastSent,
  RevitionCommand,
  type CommandContext,
  type CommandMeta,
  type HumanView,
  type TelemetryEvent,
} from '@revition/cli-core';

interface Out {
  readonly events: readonly TelemetryEvent[];
}

export default class TelemetryShowLast extends RevitionCommand<Out> {
  static override summary = 'Print the last 20 telemetry events exactly as they were sent.';
  static override examples = ['revition telemetry show-last --json'];
  static meta: CommandMeta = {
    id: 'telemetry:show-last',
    summary: TelemetryShowLast.summary,
    examples: TelemetryShowLast.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.telemetry.show-last.v1',
    stability: 'stable',
  };

  protected async run2(_ctx: CommandContext): Promise<Out> {
    return { events: await lastSent(defaultCliPaths().stateDir) };
  }

  protected override human(d: Out): HumanView {
    return { text: d.events.length === 0 ? 'Nothing has been sent.\n' : `${d.events.map((e) => JSON.stringify(e)).join('\n')}\n` };
  }
}
