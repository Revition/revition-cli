import { Flags } from '@oclif/core';
import {
  CLI_SCOPES,
  RevitionCommand,
  usageError,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

import { runtime } from '../../runtime.js';

interface Out {
  /** Shown ONCE: the platform keeps only its hash. */
  readonly token: string;
  readonly tokenId: string;
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly expiresAt: string;
}

export function parseDays(raw: string): number {
  const m = /^(\d{1,3})d?$/.exec(raw.trim());
  if (m === null) throw usageError('EXPIRES_INVALID', `"${raw}" is not a duration in days (e.g. 30d).`);
  return Number(m[1]);
}

export default class TokenCreate extends RevitionCommand<Out> {
  static override summary = 'Create a personal access token for CI (shown once; never stored by the CLI).';
  static override examples = ['revition token create --name ci-deploy --scopes cli:read,cli:write --expires 30d --yes'];
  static meta: CommandMeta = {
    id: 'token:create',
    summary: TokenCreate.summary,
    examples: TokenCreate.examples,
    requiredScopes: ['cli:write'],
    mutates: true,
    confirm: 'prompt',
    jsonSchemaId: 'revition.token.create.v1',
    stability: 'stable',
  };
  static override flags = {
    name: Flags.string({ required: true, description: 'A label for the token (up to 60 characters).' }),
    scopes: Flags.string({ default: 'cli:read', description: `Comma-separated scopes (${CLI_SCOPES.join(', ')}).` }),
    expires: Flags.string({ default: '30d', description: 'Lifetime in days, at most 90 (e.g. 30d).' }),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const f = ctx.commandFlags;
    const scopes = String(f['scopes']).split(',').map((s) => s.trim()).filter((s) => s !== '');
    const rt = await runtime(ctx);
    const res = await rt.session.client.request<{ token: string; pat: { tokenId: string; prefix: string; scopes: string[]; expiresAt: string } }>({
      method: 'POST',
      path: '/dev/tokens',
      body: { name: String(f['name']), scopes, expiresInDays: parseDays(String(f['expires'])) },
    });
    if (ctx.flags.json) ctx.warn('data.token is shown once: store it in your CI secret store now; it cannot be shown again.');
    else if (ctx.io.stdoutIsTTY) ctx.io.err('This token is shown once. Store it in your CI secret store now; it cannot be shown again.\n');
    return { token: res.body.token, tokenId: res.body.pat.tokenId, prefix: res.body.pat.prefix, scopes: res.body.pat.scopes, expiresAt: res.body.pat.expiresAt };
  }

  protected override human(d: Out): HumanView {
    // The token is the one value printed unredacted, once, on stdout (T1.3.6); stderr carries the warning only.
    return { text: '', reveal: d.token };
  }

  protected override reveal(d: Out): { key: string; value: string } {
    return { key: 'token', value: d.token };
  }
}
