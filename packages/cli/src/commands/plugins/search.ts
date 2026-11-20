import { Args } from '@oclif/core';
import { RevitionCommand, renderTable, terminalTable, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { pluginsRuntime } from '../../plugins-runtime.js';

interface Entry {
  readonly name: string;
  readonly publisherId: string;
  readonly publisherName: string | null;
  readonly summary: string;
  readonly allowed: boolean;
}

interface Out {
  readonly plugins: readonly Entry[];
}

/** T4.2.3 - search the Developer Portal's registry of verified plugins (with your workspace's verdict on each). */
export default class PluginsSearch extends RevitionCommand<Out> {
  static override summary = 'Search the registry of verified plugins.';
  static override examples = ['revition plugins search tickets', 'revition plugins search --json'];
  static meta: CommandMeta = {
    id: 'plugins:search',
    summary: PluginsSearch.summary,
    examples: PluginsSearch.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.plugins.search.v1',
    stability: 'stable',
  };
  static override args = { query: Args.string({ required: false, description: 'Words to match in the name or summary.' }) };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const p = await pluginsRuntime(ctx);
    const q = typeof ctx.args['query'] === 'string' ? ctx.args['query'] : '';
    return { plugins: (await p.platform.search(q)).map((e) => ({ ...e })) };
  }

  protected override human(d: Out): HumanView {
    if (d.plugins.length === 0) return { text: 'No verified plugins match.\n' };
    return {
      text: renderTable(
        ['name', 'publisher', 'workspace', 'summary'],
        d.plugins.map((e) => [e.name, e.publisherName ?? e.publisherId, e.allowed ? 'allowed' : 'not allowed', e.summary]),
        terminalTable()
      ),
    };
  }
}
