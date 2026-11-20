import { resolve } from 'node:path';

import { Args, Flags } from '@oclif/core';
import { atomicWriteFile, RevitionCommand, usageError, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { definitionText, draftBody } from '../../format.js';

import { agentsApi, bodyHash, projectDir, readDefinition, seg, writePullRecord } from './list.js';

interface Out {
  readonly agentId: string;
  readonly template: string;
  readonly version: number;
  readonly file: string;
}

/**
 * T3.1.3 - `revition agents create <file> [--template <id>]`: a new agent the way the web makes one (POST
 * /agent-templates/scaffold, `blank` by default), then the file's body saved to its DRAFT. The live agent is
 * untouched; the file gets the new id so later pushes go to it.
 */
export default class AgentsCreate extends RevitionCommand<Out> {
  static override summary = 'Create an agent from a definition file (its draft = the file; nothing goes live).';
  static override examples = ['revition agents create agents/support.agent.yaml', 'revition agents create agents/support.agent.yaml --template blank --yes'];
  static meta: CommandMeta = {
    id: 'agents:create',
    summary: AgentsCreate.summary,
    examples: AgentsCreate.examples,
    requiredScopes: ['cli:agents'],
    mutates: true,
    confirm: 'prompt',
    jsonSchemaId: 'revition.agents.create.v1',
    stability: 'beta',
  };
  static override args = { file: Args.string({ required: true, description: 'The definition file (agent.id: null).' }) };
  static override flags = { template: Flags.string({ description: 'The template to start from (default: blank; see `revition agents templates`).' }) };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const dir = projectDir();
    const file = resolve(dir, String(ctx.args['file']));
    const { definition } = readDefinition(file);
    if (definition.agent.id !== null) {
      throw usageError('AGENT_EXISTS', `This file already names agent ${definition.agent.id}.`, 'Use `revition agents push` to change its draft.');
    }
    const template = typeof ctx.commandFlags['template'] === 'string' ? ctx.commandFlags['template'] : 'blank';
    const api = await agentsApi(ctx);
    const made = (await api.request<{ deploymentId: string }>({ method: 'POST', path: '/agent-templates/scaffold', body: { templateAppId: template, name: definition.agent.name } })).body;
    const saved = (await api.request<{ draft: { version: number } }>({ method: 'PUT', path: `/deployments/${seg(made.deploymentId)}/draft`, body: draftBody(definition, null) })).body;
    const withId = { ...definition, agent: { ...definition.agent, id: made.deploymentId } };
    await atomicWriteFile(file, definitionText(withId));
    await writePullRecord(dir, { agentId: made.deploymentId, version: saved.draft.version, bodyHash: bodyHash(definition.config) });
    return { agentId: made.deploymentId, template, version: saved.draft.version, file };
  }

  protected override human(o: Out): HumanView {
    return { text: `Created ${o.agentId} from ${o.template}; its draft (version ${o.version}) is the file, now pointing at it: ${o.file}\nGo live in the portal: revition agents open ${o.agentId} --action publish\n` };
  }
}
