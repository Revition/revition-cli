import { Args } from '@oclif/core';
import { RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi, seg, type StarterDetail } from '../../api.js';

interface Out {
  readonly id: string;
  readonly title: string;
  readonly extensionPoint: string;
  readonly language: string;
  readonly files: readonly string[];
}

export default class StartersView extends RevitionCommand<Out> {
  static override summary = 'Show one starter and the files it creates.';
  static override examples = ['revition starters view hello-tool'];
  static meta: CommandMeta = {
    id: 'starters:view',
    summary: StartersView.summary,
    examples: StartersView.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.starters.view.v1',
    stability: 'stable',
  };
  static override args = { id: Args.string({ required: true, description: 'The starter id (from `starters list`).' }) };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const api = await devApi(ctx);
    const s = (await api.request<StarterDetail>({ method: 'GET', path: `/dev/starters/${seg(String(ctx.args['id']))}` })).body;
    return { id: s.id, title: s.title, extensionPoint: s.extensionPoint, language: s.language, files: Object.keys(s.files ?? {}).sort() };
  }

  protected override human(s: Out): HumanView {
    return { text: `${s.title} (${s.id})\nextension point: ${s.extensionPoint}  language: ${s.language}\nfiles:\n${s.files.map((f) => `  ${f}`).join('\n')}\n` };
  }
}
