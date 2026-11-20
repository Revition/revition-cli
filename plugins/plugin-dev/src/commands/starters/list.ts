import { Flags } from '@oclif/core';
import { RevitionCommand, renderTable, terminalTable, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi, type Starter } from '../../api.js';

interface Out {
  readonly starters: readonly Starter[];
}

export default class StartersList extends RevitionCommand<Out> {
  static override summary = "List the platform's project starters.";
  static override examples = ['revition starters list', 'revition starters list --point scheduled_job --json'];
  static meta: CommandMeta = {
    id: 'starters:list',
    summary: StartersList.summary,
    examples: StartersList.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.starters.list.v1',
    stability: 'stable',
  };
  static override flags = {
    point: Flags.string({ description: 'Only the starters of this extension point.' }),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const api = await devApi(ctx);
    const point = ctx.commandFlags['point'];
    const query = typeof point === 'string' && point !== '' ? { extensionPoint: point } : undefined;
    const body = (await api.request<Out>({ method: 'GET', path: '/dev/starters', ...(query === undefined ? {} : { query }) })).body;
    return { starters: body.starters };
  }

  protected override human(d: Out): HumanView {
    return {
      text: renderTable(
        ['id', 'title', 'extension point', 'language'],
        d.starters.map((s) => [s.id, s.title, s.extensionPoint, s.language]),
        terminalTable()
      ),
    };
  }
}
