import { RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi, type DeveloperAccount } from '../../api.js';

export default class AccountStatus extends RevitionCommand<DeveloperAccount> {
  static override summary = 'Show your developer account: kind, linked workspace, verification and wallet.';
  static override examples = ['revition account status', 'revition account status --json'];
  static meta: CommandMeta = {
    id: 'account:status',
    summary: AccountStatus.summary,
    examples: AccountStatus.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.account.status.v1',
    stability: 'stable',
  };

  protected async run2(ctx: CommandContext): Promise<DeveloperAccount> {
    const api = await devApi(ctx);
    return (await api.request<DeveloperAccount>({ method: 'GET', path: '/dev/me' })).body;
  }

  protected override human(a: DeveloperAccount): HumanView {
    return {
      text: [
        `developer: ${a.developerId}`,
        `kind: ${a.kind}`,
        `workspace: ${a.linkedOrgId ?? 'none'}`,
        `verified: ${a.verified ? 'yes' : 'no'}`,
        `wallet: ${a.developerWalletId}`,
        '',
      ].join('\n'),
    };
  }
}
