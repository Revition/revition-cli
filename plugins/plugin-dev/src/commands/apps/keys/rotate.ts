import { Args } from '@oclif/core';
import { RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi, seg } from '../../../api.js';
import { issued, revealView, warnOnce, type IssuedKey, type KeyView } from '../../../apps/keys.js';

export default class AppsKeysRotate extends RevitionCommand<IssuedKey> {
  static override summary = 'Rotate an app key: a new key (printed once); the old one keeps working for the 7-day grace.';
  static override examples = ['revition apps keys rotate dapp_123 0123abcd4567ef89 --yes'];
  static meta: CommandMeta = {
    id: 'apps:keys:rotate',
    summary: AppsKeysRotate.summary,
    examples: AppsKeysRotate.examples,
    requiredScopes: ['cli:write'],
    mutates: true,
    confirm: 'prompt',
    jsonSchemaId: 'revition.apps.keys.rotate.v1',
    stability: 'stable',
  };
  static override args = {
    app: Args.string({ required: true, description: 'The app id.' }),
    keyId: Args.string({ required: true, description: 'The key id (from `apps keys list`).' }),
  };

  protected async run2(ctx: CommandContext): Promise<IssuedKey> {
    const api = await devApi(ctx);
    const body = (await api.request<{ key: string; view: KeyView }>({
      method: 'POST',
      path: `/dev/apps/${seg(String(ctx.args['app']))}/keys/${seg(String(ctx.args['keyId']))}/rotate`,
    })).body;
    warnOnce(ctx);
    return issued(body);
  }

  protected override human(k: IssuedKey): HumanView {
    return revealView(k);
  }

  protected override reveal(k: IssuedKey): { key: string; value: string } {
    return { key: 'secret', value: k.secret };
  }
}
