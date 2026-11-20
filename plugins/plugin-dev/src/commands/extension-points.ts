import { RevitionCommand, renderTable, terminalTable, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi } from '../api.js';

/** T2.4.4 - the platform's extension points (GET /dev/extension-points): where an extension can plug in. Read only. */
interface ExtensionPoint {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly surface: string;
}

interface Out {
  readonly extensionPoints: readonly ExtensionPoint[];
}

export default class ExtensionPoints extends RevitionCommand<Out> {
  static override summary = "The platform's extension points: where an extension can plug in.";
  static override examples = ['revition extension-points', 'revition extension-points --json'];
  static meta: CommandMeta = {
    id: 'extension-points',
    summary: ExtensionPoints.summary,
    examples: ExtensionPoints.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.extension-points.v1',
    stability: 'stable',
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const api = await devApi(ctx);
    return { extensionPoints: (await api.request<Out>({ method: 'GET', path: '/dev/extension-points' })).body.extensionPoints };
  }

  protected override human(o: Out): HumanView {
    return {
      text: renderTable(
        ['id', 'title', 'surface', 'what'],
        o.extensionPoints.map((p) => [p.id, p.title, p.surface, p.description]),
        terminalTable()
      ),
    };
  }
}
