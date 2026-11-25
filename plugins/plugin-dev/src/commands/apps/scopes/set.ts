import { Args, Flags } from '@oclif/core';
import { RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi, seg, type AppRegistration } from '../../../api.js';
import { ownApp, parseScopes, scopeDiff } from '../../../apps/apps-api.js';

interface Out {
  readonly app: AppRegistration;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly revokedKeys: readonly string[];
}

export default class AppsScopesSet extends RevitionCommand<Out> {
  static override summary = "Change an app's declared scopes: the permission diff is shown before you confirm.";
  static override examples = ['revition apps scopes set dapp_123 --scopes source:orders,data.read:orders', 'revition apps scopes set dapp_123 --scopes source:orders --yes'];
  static meta: CommandMeta = {
    id: 'apps:scopes:set',
    summary: AppsScopesSet.summary,
    examples: AppsScopesSet.examples,
    requiredScopes: ['cli:write'],
    mutates: true,
    confirm: 'prompt',
    jsonSchemaId: 'revition.apps.scopes.set.v1',
    stability: 'stable',
  };
  static override args = { id: Args.string({ required: true, description: 'The app id.' }) };
  static override flags = { scopes: Flags.string({ required: true, description: 'The complete new scope list (comma-separated).' }) };

  private plan: { app: AppRegistration; next: string[]; added: string[]; removed: string[] } | null = null;

  /** The permission diff, before the confirmation. */
  protected override async beforeConfirm(ctx: CommandContext): Promise<void> {
    const app = await ownApp(await devApi(ctx), String(ctx.args['id']));
    const next = parseScopes(ctx.commandFlags['scopes']);
    const d = scopeDiff(app.declaredScopes, next);
    this.plan = { app, next, ...d };
    const lines = [`Scopes of ${app.appId}:`, ...d.added.map((s) => `  + ${s}`), ...d.removed.map((s) => `  - ${s}`)];
    if (d.added.length === 0 && d.removed.length === 0) lines.push('  (no change)');
    if (d.added.length > 0) lines.push('Widening the scopes re-issues every key of the app: the current keys stop working.');
    ctx.io.err(`${lines.join('\n')}\n`);
  }

  protected async run2(ctx: CommandContext): Promise<Out> {
    if (this.plan === null) await this.beforeConfirm(ctx);
    const p = this.plan as NonNullable<typeof this.plan>;
    const api = await devApi(ctx);
    // consent: true only after the confirmation (the platform refuses a widening without it).
    const r = (await api.request<{ app: AppRegistration; revokedKeys: string[] }>({
      method: 'PUT',
      path: `/dev/apps/${seg(p.app.appId)}/scopes`,
      body: { scopes: p.next, consent: true },
    })).body;
    return { app: r.app, added: p.added, removed: p.removed, revokedKeys: r.revokedKeys };
  }

  protected override human(o: Out): HumanView {
    const keys = o.revokedKeys.length === 0 ? '' : ` ${o.revokedKeys.length} key(s) revoked: create new ones with \`revition apps keys create\`.`;
    return { text: `Scopes of ${o.app.appId}: ${o.app.declaredScopes.join(', ') || '-'}.${keys}\n` };
  }
}
