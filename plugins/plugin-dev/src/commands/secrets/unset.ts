import { Args, Flags } from '@oclif/core';
import { RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi } from '../../api.js';
import { deleteSecret } from '../../secrets/secrets-api.js';

interface Out {
  readonly name: string;
  readonly appId: string | null;
}

export default class SecretsUnset extends RevitionCommand<Out> {
  static override summary = 'Remove a runtime secret.';
  static override examples = ['revition secrets unset API_KEY', 'revition secrets unset API_KEY --app dapp_123 --yes'];
  static meta: CommandMeta = {
    id: 'secrets:unset',
    summary: SecretsUnset.summary,
    examples: SecretsUnset.examples,
    requiredScopes: ['cli:write'],
    mutates: true,
    confirm: 'prompt',
    jsonSchemaId: 'revition.secrets.unset.v1',
    stability: 'stable',
  };
  static override args = { name: Args.string({ required: true, description: 'The secret name.' }) };
  static override flags = { app: Flags.string({ description: "An app's secret instead of the workspace's." }) };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const name = String(ctx.args['name']);
    const app = typeof ctx.commandFlags['app'] === 'string' ? ctx.commandFlags['app'] : null;
    await deleteSecret(await devApi(ctx), app, name);
    return { name, appId: app };
  }

  protected override human(o: Out): HumanView {
    return { text: `Removed ${o.name}${o.appId === null ? '' : ` from ${o.appId}`}.\n` };
  }
}
