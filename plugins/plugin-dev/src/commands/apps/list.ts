import { RevitionCommand, renderTable, terminalTable, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi, type AppRegistration } from '../../api.js';
import { listApps } from '../../apps/apps-api.js';

interface Out {
  readonly apps: readonly AppRegistration[];
}

export default class AppsList extends RevitionCommand<Out> {
  static override summary = 'List your registered apps.';
  static override examples = ['revition apps list', 'revition apps list --json'];
  static meta: CommandMeta = {
    id: 'apps:list',
    summary: AppsList.summary,
    examples: AppsList.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.apps.list.v1',
    stability: 'stable',
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    return { apps: await listApps(await devApi(ctx)) };
  }

  protected override human(d: Out): HumanView {
    return {
      text: renderTable(
        ['app', 'manifest', 'scopes', 'created'],
        d.apps.map((a) => [a.appId, a.manifestRef, a.declaredScopes.join(',') || '-', a.createdAt.slice(0, 10)]),
        terminalTable()
      ),
    };
  }
}
