import { defaultCliPaths, RevitionCommand, renderTable, terminalTable, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';
import { listInstalled } from '@revition/cli-core/plugins';

interface Installed {
  readonly name: string;
  readonly version: string;
  readonly publisherId: string;
  readonly permissions: readonly string[];
  readonly commands: readonly string[];
  readonly installedAt: string;
}

interface Out {
  readonly plugins: readonly Installed[];
}

/** T4.2.3 - the plugins installed on this machine (local; nothing is sent). */
export default class PluginsList extends RevitionCommand<Out> {
  static override summary = 'List the plugins installed on this machine.';
  static override examples = ['revition plugins list', 'revition plugins list --json'];
  static meta: CommandMeta = {
    id: 'plugins:list',
    summary: PluginsList.summary,
    examples: PluginsList.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.plugins.list.v1',
    stability: 'stable',
  };

  protected async run2(_ctx: CommandContext): Promise<Out> {
    const all = await listInstalled(defaultCliPaths().configDir);
    return {
      plugins: all.map((p) => ({
        name: p.name,
        version: p.version,
        publisherId: p.publisherId,
        permissions: p.permissions,
        commands: Object.keys(p.commands),
        installedAt: p.installedAt,
      })),
    };
  }

  protected override human(d: Out): HumanView {
    if (d.plugins.length === 0) return { text: 'No plugins installed.\n' };
    return {
      text: renderTable(
        ['name', 'version', 'publisher', 'commands'],
        d.plugins.map((p) => [p.name, p.version, p.publisherId, p.commands.join(',')]),
        terminalTable()
      ),
    };
  }
}
