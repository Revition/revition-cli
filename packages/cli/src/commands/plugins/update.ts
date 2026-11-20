import { Args } from '@oclif/core';
import { RevitionCliError, RevitionCommand, EXIT, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';
import { commitInstall, listInstalled, npmRegistry, prepareInstall, type PreparedInstall } from '@revition/cli-core/plugins';

import { pluginsRuntime } from '../../plugins-runtime.js';

interface Out {
  readonly name: string;
  readonly from: string;
  readonly to: string;
  readonly updated: boolean;
  readonly permissions: readonly string[];
}

/**
 * T4.2.3 - update an installed plugin to its latest version: the same checks as install (listed, allowed, verified,
 * publisher match), and the NEW version's permissions are shown before you confirm.
 */
export default class PluginsUpdate extends RevitionCommand<Out> {
  static override summary = 'Update an installed plugin to its latest verified version.';
  static override examples = ['revition plugins update @acme/revition-plugin-tickets'];
  static meta: CommandMeta = {
    id: 'plugins:update',
    summary: PluginsUpdate.summary,
    examples: PluginsUpdate.examples,
    requiredScopes: ['cli:read'],
    mutates: true,
    confirm: 'prompt',
    jsonSchemaId: 'revition.plugins.update.v1',
    stability: 'stable',
  };
  static override args = { plugin: Args.string({ required: true, description: 'The installed plugin name.' }) };

  private prepared: PreparedInstall | null = null;
  private configDir = '';
  private from = '';

  protected override async beforeConfirm(ctx: CommandContext): Promise<void> {
    const name = String(ctx.args['plugin']);
    const p = await pluginsRuntime(ctx);
    this.configDir = p.configDir;
    const current = (await listInstalled(p.configDir)).find((x) => x.name === name);
    if (current === undefined) throw new RevitionCliError({ code: 'PLUGIN_NOT_INSTALLED', message: `${name} is not installed.` }, EXIT.notFound);
    this.from = current.version;
    this.prepared = await prepareInstall(`${name}@latest`, { registry: npmRegistry(ctx.env), index: p.platform, publishers: p.platform });
    ctx.io.err(`${name}: ${current.version} -> ${this.prepared.verified.version}. It may:\n${this.prepared.permissions.map((l) => `  - ${l}`).join('\n')}\n`);
  }

  protected async run2(_ctx: CommandContext): Promise<Out> {
    if (this.prepared === null) throw new Error('internal: nothing was verified');
    const v = this.prepared.verified;
    const updated = v.version !== this.from;
    if (updated) await commitInstall(this.prepared, this.configDir, new Date().toISOString());
    return { name: v.name, from: this.from, to: v.version, updated, permissions: this.prepared.permissions };
  }

  protected override human(d: Out): HumanView {
    return { text: d.updated ? `Updated ${d.name} ${d.from} -> ${d.to}.\n` : `${d.name} is already at ${d.to}.\n` };
  }
}
