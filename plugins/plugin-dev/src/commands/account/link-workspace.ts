import { Flags } from '@oclif/core';
import { RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi, type DeveloperAccount } from '../../api.js';

export default class AccountLinkWorkspace extends RevitionCommand<DeveloperAccount> {
  static override summary = 'Link your developer account to a workspace you are a member of (your wallet stays yours).';
  static override examples = ['revition account link-workspace --org org_123'];
  static meta: CommandMeta = {
    id: 'account:link-workspace',
    summary: AccountLinkWorkspace.summary,
    examples: AccountLinkWorkspace.examples,
    requiredScopes: ['cli:write'],
    mutates: true,
    confirm: 'prompt',
    jsonSchemaId: 'revition.account.link-workspace.v1',
    stability: 'stable',
  };
  static override flags = {
    org: Flags.string({ required: true, description: 'The workspace (org id). The platform checks your membership.' }),
  };

  protected async run2(ctx: CommandContext): Promise<DeveloperAccount> {
    const api = await devApi(ctx);
    // The membership check is the platform's (POST /dev/link): a non-member gets 403 -> exit 4.
    return (await api.request<DeveloperAccount>({ method: 'POST', path: '/dev/link', body: { orgId: String(ctx.commandFlags['org']) } })).body;
  }

  protected override human(a: DeveloperAccount): HumanView {
    return { text: `Linked to workspace ${a.linkedOrgId ?? '-'} (${a.kind}). Your developer wallet is unchanged.\n` };
  }
}
