import { Args, Flags } from '@oclif/core';
import { RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi, seg } from '../../../api.js';
import { parseScopes } from '../../../apps/apps-api.js';
import { issued, revealView, warnOnce, type IssuedKey, type KeyView } from '../../../apps/keys.js';

export default class AppsKeysCreate extends RevitionCommand<IssuedKey> {
  static override summary = 'Create an app key: printed once, never stored by the CLI.';
  static override examples = ['revition apps keys create dapp_123 --yes', 'revition apps keys create dapp_123 --scopes source:orders --json --yes'];
  static meta: CommandMeta = {
    id: 'apps:keys:create',
    summary: AppsKeysCreate.summary,
    examples: AppsKeysCreate.examples,
    requiredScopes: ['cli:write'],
    mutates: true,
    confirm: 'prompt',
    jsonSchemaId: 'revition.apps.keys.create.v1',
    stability: 'stable',
  };
  static override args = { app: Args.string({ required: true, description: 'The app id.' }) };
  static override flags = { scopes: Flags.string({ description: "Comma-separated scopes (default: the app's declared scopes)." }) };

  protected async run2(ctx: CommandContext): Promise<IssuedKey> {
    const scopes = parseScopes(ctx.commandFlags['scopes']);
    const api = await devApi(ctx);
    const body = (await api.request<{ key: string; view: KeyView }>({
      method: 'POST',
      path: `/dev/apps/${seg(String(ctx.args['app']))}/keys`,
      body: scopes.length === 0 ? {} : { scopes },
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
