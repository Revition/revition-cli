import { Args, Flags } from '@oclif/core';
import { RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi } from '../../api.js';
import { listSecrets, putSecret, readSecretValue, SECRET_ENVS, secretEnvOf } from '../../secrets/secrets-api.js';

interface Out {
  readonly name: string;
  readonly scope: 'workspace' | 'app';
  readonly appId: string | null;
}

export default class SecretsSet extends RevitionCommand<Out> {
  static override summary = 'Set a runtime secret. The value comes from stdin or a hidden prompt, never from an argument.';
  static override examples = ['revition secrets set API_KEY', 'revition secrets set API_KEY --yes < key.txt', 'cat cert.pem | revition secrets set TLS_CERT --app dapp_123 --yes'];
  static meta: CommandMeta = {
    id: 'secrets:set',
    summary: SecretsSet.summary,
    examples: SecretsSet.examples,
    requiredScopes: ['cli:write'],
    mutates: true,
    confirm: 'prompt',
    jsonSchemaId: 'revition.secrets.set.v1',
    stability: 'stable',
  };
  // The NAME only: there is deliberately no flag or argument for the value (T1.3.6, T2.2.3 AC1).
  static override args = { name: Args.string({ required: true, description: 'The secret name.' }) };
  static override flags = {
    app: Flags.string({ description: "An app's secret instead of the workspace's." }),
    env: Flags.string({ options: [...SECRET_ENVS], description: "The workspace secret's environment (dev, test, staging, prod); default prod." }),
  };

  /** The cost of the first app secret (its store), shown before the confirmation when the platform passes one on. */
  protected override async beforeConfirm(ctx: CommandContext): Promise<void> {
    const app = typeof ctx.commandFlags['app'] === 'string' ? ctx.commandFlags['app'] : null;
    if (app === null) return;
    const cost = (await listSecrets(await devApi(ctx), app)).firstSetCost;
    if (cost !== null) ctx.io.err(`Your first secret creates your secret store: $${cost.monthlyUsd.toFixed(2)} a month (${cost.note}).\n`);
  }

  protected async run2(ctx: CommandContext): Promise<Out> {
    const name = String(ctx.args['name']);
    const app = typeof ctx.commandFlags['app'] === 'string' ? ctx.commandFlags['app'] : null;
    const env = secretEnvOf(app, ctx.commandFlags['env']);
    const value = await readSecretValue(ctx);
    await putSecret(await devApi(ctx), app, name, value, env);
    return { name, scope: app === null ? 'workspace' : 'app', appId: app };
  }

  protected override human(o: Out): HumanView {
    return { text: `Set ${o.name}${o.appId === null ? '' : ` for ${o.appId}`}.\n` };
  }
}
