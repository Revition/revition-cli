import { RevitionCommand, renderTable, terminalTable, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { agentsApi } from './list.js';

/** T3.1.3 - the templates an agent can be created from (GET /agent-templates; `blank` is one of them). Read only. */
interface Template {
  readonly appId?: string;
  readonly templateAppId?: string;
  readonly name?: string;
  readonly title?: string;
  readonly useCase?: string;
}

interface Out {
  readonly templates: readonly Template[];
}

export default class AgentsTemplates extends RevitionCommand<Out> {
  static override summary = 'The agent templates `agents create --template` can start from.';
  static override examples = ['revition agents templates', 'revition agents templates --json'];
  static meta: CommandMeta = {
    id: 'agents:templates',
    summary: AgentsTemplates.summary,
    examples: AgentsTemplates.examples,
    requiredScopes: ['cli:agents'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.agents.templates.v1',
    stability: 'beta',
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const api = await agentsApi(ctx);
    return { templates: (await api.request<Out>({ method: 'GET', path: '/agent-templates' })).body.templates };
  }

  protected override human(o: Out): HumanView {
    return {
      text: renderTable(
        ['template', 'name', 'use case'],
        o.templates.map((t) => [t.templateAppId ?? t.appId ?? '-', t.name ?? t.title ?? '-', t.useCase ?? '-']),
        terminalTable()
      ),
    };
  }
}
