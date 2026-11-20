import { Flags } from '@oclif/core';
import { RevitionCommand, renderTable, terminalTable, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi } from '../../api.js';
import { listSecrets, type SecretsList } from '../../secrets/secrets-api.js';

export default class SecretsListCommand extends RevitionCommand<SecretsList> {
  static override summary = "List runtime secret NAMES (the workspace's, or an app's with --app); values are never shown.";
  static override examples = ['revition secrets list', 'revition secrets list --app dapp_123 --json'];
  static meta: CommandMeta = {
    id: 'secrets:list',
    summary: SecretsListCommand.summary,
    examples: SecretsListCommand.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.secrets.list.v1',
    stability: 'stable',
  };
  static override flags = { app: Flags.string({ description: "An app's secrets (an independent developer's apps) instead of the workspace's." }) };

  protected async run2(ctx: CommandContext): Promise<SecretsList> {
    const app = typeof ctx.commandFlags['app'] === 'string' ? ctx.commandFlags['app'] : null;
    return listSecrets(await devApi(ctx), app);
  }

  protected override human(d: SecretsList): HumanView {
    return {
      text: renderTable(['name', 'updated'], d.names.map((n) => [n.name, n.updatedAt ?? '-']), terminalTable()),
    };
  }
}
