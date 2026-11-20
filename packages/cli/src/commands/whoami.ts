import {
  describeIdentity,
  RevitionCliError,
  RevitionCommand,
  type CommandContext,
  type CommandMeta,
  type DeveloperMe,
  type HumanView,
  type Identity,
} from '@revition/cli-core';

import { runtime } from '../runtime.js';

export default class Whoami extends RevitionCommand<Identity> {
  static override summary = 'Show who you are signed in as, the workspace the platform resolved, and the host.';
  static override examples = ['revition whoami', 'revition whoami --json'];
  static meta: CommandMeta = {
    id: 'whoami',
    summary: Whoami.summary,
    examples: Whoami.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.whoami.v1',
    stability: 'stable',
  };

  protected async run2(ctx: CommandContext): Promise<Identity> {
    const rt = await runtime(ctx);
    if (rt.session.mode === 'none') {
      throw new RevitionCliError({ code: 'AUTH_REQUIRED', message: 'You are not signed in.', hint: 'Run `revition login`.' }, 3);
    }
    const me = (await rt.session.client.request<DeveloperMe>({ method: 'GET', path: '/dev/me' })).body;
    const s = rt.session.stored;
    return describeIdentity(me, {
      host: rt.host,
      profile: rt.profile,
      email: s?.email ?? null,
      sessionId: s?.sessionId ?? null,
      authFreshUntil: s?.authFreshUntil ?? null,
      method: rt.session.mode === 'pat' ? 'token' : (s?.method ?? 'browser'),
    });
  }

  protected override human(i: Identity): HumanView {
    const lines = [
      `${i.user} (${i.identityKind})`,
      `workspace: ${i.workspace ?? 'none'}`,
      `host: ${i.host}  profile: ${i.profile}  sign-in: ${i.method}`,
      ...(i.sessionId === null ? [] : [`session: ${i.sessionId}  fresh until: ${i.authFreshUntil ?? '-'}`]),
      ...(i.note === null ? [] : [i.note]),
    ];
    return { text: `${lines.join('\n')}\n` };
  }
}
