import { Flags } from '@oclif/core';
import {
  canPrompt,
  confirmYes,
  RevitionCommand,
  usageError,
  webLinksOf,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

import { devApi, type DeveloperAccount } from '../../api.js';

export default class AccountRegister extends RevitionCommand<DeveloperAccount> {
  static override summary = 'Create your developer account (free; idempotent).';
  static override examples = [
    'revition account register',
    'revition account register --kind tenant_member --org org_123 --accept-terms --yes',
  ];
  static meta: CommandMeta = {
    id: 'account:register',
    summary: AccountRegister.summary,
    examples: AccountRegister.examples,
    requiredScopes: ['cli:write'],
    mutates: true,
    confirm: 'prompt',
    jsonSchemaId: 'revition.account.register.v1',
    stability: 'stable',
  };
  static override flags = {
    kind: Flags.option({ options: ['independent', 'tenant_member'] as const, default: 'independent', description: 'independent (no workspace) or tenant_member (an SSO member of a workspace).' })(),
    org: Flags.string({ description: 'The workspace (org id) a tenant member signs in with.' }),
    'accept-terms': Flags.boolean({ description: 'Accept the developer agreement without a prompt (required off a terminal).' }),
  };

  protected async run2(ctx: CommandContext): Promise<DeveloperAccount> {
    const f = ctx.commandFlags;
    const kind = String(f['kind'] ?? 'independent');
    const org = typeof f['org'] === 'string' && f['org'] !== '' ? f['org'] : null;
    if (kind === 'tenant_member' && org === null) throw usageError('ORG_REQUIRED', 'A tenant member registers with --org <orgId>.');
    if (kind === 'independent' && org !== null) throw usageError('ORG_NOT_ALLOWED', 'An independent developer belongs to no workspace: drop --org.');
    if (f['accept-terms'] !== true) {
      ctx.io.err(`The developer agreement is shown in the Developer Portal: ${(await webLinksOf(ctx)).developer}\n`);
      if (!canPrompt(ctx.io, { json: ctx.flags.json, noInput: ctx.flags.noInput })) {
        throw usageError('TERMS_NOT_ACCEPTED', 'Registering needs the developer agreement accepted.', 'Re-run with --accept-terms.');
      }
      if (!(await confirmYes(ctx.io, 'Do you accept the developer agreement?'))) {
        throw usageError('TERMS_NOT_ACCEPTED', 'Registering needs the developer agreement accepted.');
      }
    }
    const api = await devApi(ctx);
    const body = { kind, agreementAccepted: true, ...(org === null ? {} : { linkedOrgId: org }) };
    return (await api.request<DeveloperAccount>({ method: 'POST', path: '/dev/register', body })).body;
  }

  protected override human(a: DeveloperAccount): HumanView {
    const ws = a.linkedOrgId === null ? 'no workspace' : `workspace ${a.linkedOrgId}`;
    return { text: `Developer account ${a.developerId} (${a.kind}, ${ws}). Wallet: ${a.developerWalletId}.\n` };
  }
}
