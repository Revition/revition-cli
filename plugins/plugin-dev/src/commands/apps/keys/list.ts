import { Args } from '@oclif/core';
import { RevitionCommand, renderTable, terminalTable, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi, seg } from '../../../api.js';
import type { KeyView } from '../../../apps/keys.js';

interface Out {
  readonly keys: readonly KeyView[];
}

export default class AppsKeysList extends RevitionCommand<Out> {
  static override summary = "List an app's keys (ids and state; never a secret).";
  static override examples = ['revition apps keys list dapp_123'];
  static meta: CommandMeta = {
    id: 'apps:keys:list',
    summary: AppsKeysList.summary,
    examples: AppsKeysList.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.apps.keys.list.v1',
    stability: 'stable',
  };
  static override args = { app: Args.string({ required: true, description: 'The app id.' }) };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const api = await devApi(ctx);
    return (await api.request<Out>({ method: 'GET', path: `/dev/apps/${seg(String(ctx.args['app']))}/keys` })).body;
  }

  protected override human(d: Out): HumanView {
    return {
      text: renderTable(
        ['key', 'scopes', 'expires', 'state'],
        d.keys.map((k) => [k.keyId, k.scopes.join(',') || '-', k.expiresAt.slice(0, 10), k.revokeAt === null ? 'active' : `stops ${k.revokeAt.slice(0, 16)}`]),
        terminalTable()
      ),
    };
  }
}
