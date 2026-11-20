import { Args } from '@oclif/core';
import { RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { runtime } from '../../runtime.js';

interface Out {
  readonly tokenId: string;
  readonly revokedAt: string | null;
}

export default class TokenRevoke extends RevitionCommand<Out> {
  static override summary = 'Revoke a personal access token (it stops working at once).';
  static override examples = ['revition token revoke tok_123 --yes'];
  static meta: CommandMeta = {
    id: 'token:revoke',
    summary: TokenRevoke.summary,
    examples: TokenRevoke.examples,
    // The platform route is `any` scope ('DELETE /dev/tokens/{tokenId}'): revoking your own token is always allowed.
    requiredScopes: [],
    mutates: true,
    confirm: 'prompt',
    jsonSchemaId: 'revition.token.revoke.v1',
    stability: 'stable',
  };
  static override args = { id: Args.string({ required: true, description: 'The token id (from `token list`).' }) };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const id = String(ctx.args['id']);
    const rt = await runtime(ctx);
    const body = (await rt.session.client.request<{ revokedAt?: string | null }>({ method: 'DELETE', path: `/dev/tokens/${encodeURIComponent(id)}` })).body;
    return { tokenId: id, revokedAt: body.revokedAt ?? null };
  }

  protected override human(d: Out): HumanView {
    return { text: `Revoked ${d.tokenId}.\n` };
  }
}
