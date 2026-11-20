import { Args } from '@oclif/core';
import { RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';
import { commitInstall, npmRegistry, prepareInstall, type PreparedInstall } from '@revition/cli-core/plugins';

import { pluginsRuntime } from '../../plugins-runtime.js';

interface Out {
  readonly name: string;
  readonly version: string;
  readonly publisherId: string;
  readonly builtBy: string;
  readonly permissions: readonly string[];
  readonly commands: readonly string[];
}

/**
 * T4.2.3 (REVITION-CLI-PLAN.md:3119-3135) - install a third-party plugin: the registry must list it and your workspace
 * allow it; its signature, provenance and publisher are verified (T4.2.1); its permissions are shown before you
 * confirm (T4.2.2 AC3); nothing is written before that. No install script ever runs.
 */
export default class PluginsInstall extends RevitionCommand<Out> {
  static override summary = 'Install a verified plugin (its signature, publisher and permissions are checked first).';
  static override examples = ['revition plugins install @acme/revition-plugin-tickets', 'revition plugins install @acme/revition-plugin-tickets@1.2.0 --yes'];
  static meta: CommandMeta = {
    id: 'plugins:install',
    summary: PluginsInstall.summary,
    examples: PluginsInstall.examples,
    requiredScopes: ['cli:read'],
    mutates: true,
    confirm: 'prompt',
    jsonSchemaId: 'revition.plugins.install.v1',
    stability: 'stable',
  };
  static override args = { plugin: Args.string({ required: true, description: 'The npm package name, optionally @<exact version>.' }) };

  private prepared: PreparedInstall | null = null;
  private configDir = '';

  protected override async beforeConfirm(ctx: CommandContext): Promise<void> {
    const p = await pluginsRuntime(ctx);
    this.configDir = p.configDir;
    this.prepared = await prepareInstall(String(ctx.args['plugin']), { registry: npmRegistry(ctx.env), index: p.platform, publishers: p.platform });
    const v = this.prepared.verified;
    ctx.io.err(`${v.name}@${v.version} - signed, built by ${v.builtBy}, publisher ${v.publisherId} (registered).\n`);
    ctx.io.err(`It may:\n${this.prepared.permissions.map((l) => `  - ${l}`).join('\n')}\n`);
  }

  protected async run2(_ctx: CommandContext): Promise<Out> {
    if (this.prepared === null) throw new Error('internal: nothing was verified');
    const rec = await commitInstall(this.prepared, this.configDir, new Date().toISOString());
    return {
      name: rec.name,
      version: rec.version,
      publisherId: rec.publisherId,
      builtBy: rec.builtBy,
      permissions: this.prepared.permissions,
      commands: Object.keys(rec.commands),
    };
  }

  protected override human(d: Out): HumanView {
    return { text: `Installed ${d.name}@${d.version}. Commands: ${d.commands.map((c) => `revition plugins run ${d.name} ${c}`).join(', ')}\n` };
  }
}
