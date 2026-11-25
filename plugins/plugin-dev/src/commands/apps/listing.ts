import { Args } from '@oclif/core';
import { RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi, seg } from '../../api.js';

export default class AppsListing extends RevitionCommand<Record<string, unknown>> {
  static override summary = "Show an app's marketplace listing (GET /dev/apps/{appId}/listing).";
  static override examples = ['revition apps listing dapp_123 --json'];
  static meta: CommandMeta = {
    id: 'apps:listing',
    summary: AppsListing.summary,
    examples: AppsListing.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.apps.listing.v1',
    stability: 'stable',
  };
  static override args = { id: Args.string({ required: true, description: 'The app id.' }) };

  protected async run2(ctx: CommandContext): Promise<Record<string, unknown>> {
    const api = await devApi(ctx);
    return (await api.request<Record<string, unknown>>({ method: 'GET', path: `/dev/apps/${seg(String(ctx.args['id']))}/listing` })).body;
  }

  protected override human(d: Record<string, unknown>): HumanView {
    return { text: `${JSON.stringify(d, null, 2)}\n` };
  }
}
