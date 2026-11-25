import { Args } from '@oclif/core';
import { RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi, type AppRegistration } from '../../api.js';
import { ownApp } from '../../apps/apps-api.js';

export default class AppsView extends RevitionCommand<AppRegistration> {
  static override summary = 'Show one of your apps.';
  static override examples = ['revition apps view dapp_123', 'revition apps view dapp_123 --json'];
  static meta: CommandMeta = {
    id: 'apps:view',
    summary: AppsView.summary,
    examples: AppsView.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.apps.view.v1',
    stability: 'stable',
  };
  static override args = { id: Args.string({ required: true, description: 'The app id.' }) };

  protected async run2(ctx: CommandContext): Promise<AppRegistration> {
    return ownApp(await devApi(ctx), String(ctx.args['id']));
  }

  protected override human(a: AppRegistration): HumanView {
    return { text: `${a.appId}\nmanifest: ${a.manifestRef}\nscopes: ${a.declaredScopes.join(', ') || '-'}\ncreated: ${a.createdAt}\n` };
  }
}
