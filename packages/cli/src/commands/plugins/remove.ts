import { Args } from '@oclif/core';
import { defaultCliPaths, RevitionCliError, RevitionCommand, EXIT, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';
import { removePlugin } from '@revition/cli-core/plugins';

interface Out {
  readonly removed: string;
}

/** T4.2.3 - remove an installed plugin (its folder and its record; local). */
export default class PluginsRemove extends RevitionCommand<Out> {
  static override summary = 'Remove an installed plugin.';
  static override examples = ['revition plugins remove @acme/revition-plugin-tickets --yes'];
  static meta: CommandMeta = {
    id: 'plugins:remove',
    summary: PluginsRemove.summary,
    examples: PluginsRemove.examples,
    requiredScopes: [],
    mutates: true,
    confirm: 'prompt',
    jsonSchemaId: 'revition.plugins.remove.v1',
    stability: 'stable',
  };
  static override args = { plugin: Args.string({ required: true, description: 'The installed plugin name.' }) };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const name = String(ctx.args['plugin']);
    if (!(await removePlugin(name, defaultCliPaths().configDir))) {
      throw new RevitionCliError({ code: 'PLUGIN_NOT_INSTALLED', message: `${name} is not installed.` }, EXIT.notFound);
    }
    return { removed: name };
  }

  protected override human(d: Out): HumanView {
    return { text: `Removed ${d.removed}.\n` };
  }
}
