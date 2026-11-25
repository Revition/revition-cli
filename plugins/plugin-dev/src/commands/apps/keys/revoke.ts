import { Args } from '@oclif/core';
import { RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi, seg } from '../../../api.js';

interface Out {
  readonly appId: string;
  readonly keyId: string;
  readonly revoked: boolean;
}

export default class AppsKeysRevoke extends RevitionCommand<Out> {
  static override summary = 'Revoke an app key: it stops working at once (type the key id to confirm, or --yes).';
  static override examples = ['revition apps keys revoke dapp_123 0123abcd4567ef89', 'revition apps keys revoke dapp_123 0123abcd4567ef89 --yes'];
  static meta: CommandMeta = {
    id: 'apps:keys:revoke',
    summary: AppsKeysRevoke.summary,
    examples: AppsKeysRevoke.examples,
    requiredScopes: ['cli:write'],
    mutates: true,
    confirm: 'typed',
    jsonSchemaId: 'revition.apps.keys.revoke.v1',
    stability: 'stable',
  };
  static override args = {
    app: Args.string({ required: true, description: 'The app id.' }),
    keyId: Args.string({ required: true, description: 'The key id.' }),
  };

  protected override confirmTarget(ctx: CommandContext): string | null {
    return String(ctx.args['keyId']);
  }

  protected async run2(ctx: CommandContext): Promise<Out> {
    const appId = String(ctx.args['app']);
    const keyId = String(ctx.args['keyId']);
    const api = await devApi(ctx);
    const body = (await api.request<{ revoked: boolean }>({ method: 'DELETE', path: `/dev/apps/${seg(appId)}/keys/${seg(keyId)}` })).body;
    return { appId, keyId, revoked: body.revoked };
  }

  protected override human(o: Out): HumanView {
    return { text: `Revoked ${o.keyId} of ${o.appId}.\n` };
  }
}
