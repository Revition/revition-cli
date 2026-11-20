import { RevitionCommand, renderTable, terminalTable, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { runtime } from '../../runtime.js';

interface Token {
  readonly tokenId: string;
  readonly name: string;
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly lastUsedAt: string | null;
}

interface Out {
  readonly tokens: readonly Token[];
}

export default class TokenList extends RevitionCommand<Out> {
  static override summary = 'List your personal access tokens (prefix only, never the token).';
  static override examples = ['revition token list', 'revition token list --json'];
  static meta: CommandMeta = {
    id: 'token:list',
    summary: TokenList.summary,
    examples: TokenList.examples,
    // The platform route is `any` scope (route-scopes.ts 'GET /dev/tokens'): any credential lists its own tokens.
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.token.list.v1',
    stability: 'stable',
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const rt = await runtime(ctx);
    const body = (await rt.session.client.request<{ tokens: Token[] }>({ method: 'GET', path: '/dev/tokens' })).body;
    return {
      tokens: body.tokens.map((t) => ({
        tokenId: t.tokenId,
        name: t.name,
        prefix: t.prefix,
        scopes: t.scopes,
        expiresAt: t.expiresAt,
        revokedAt: t.revokedAt ?? null,
        lastUsedAt: t.lastUsedAt ?? null,
      })),
    };
  }

  protected override human(d: Out): HumanView {
    return {
      text: renderTable(
        ['id', 'name', 'prefix', 'scopes', 'expires', 'state'],
        d.tokens.map((t) => [t.tokenId, t.name, t.prefix, t.scopes.join(','), t.expiresAt.slice(0, 10), t.revokedAt === null ? 'active' : 'revoked']),
        terminalTable()
      ),
    };
  }
}
