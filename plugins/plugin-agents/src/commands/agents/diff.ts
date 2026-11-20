import { resolve } from 'node:path';

import { Args } from '@oclif/core';
import { RevitionCommand, usageError, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { diffBySection, isEmptyDiff, type SectionDiff } from '../../format.js';

import { agentsApi, getDraft, projectDir, readDefinition, seg } from './list.js';
import type { DraftDiff } from './push.js';

interface Out {
  readonly agentId: string;
  /** The file against the remote draft, by section (config fields and sections). */
  readonly vsDraft: SectionDiff;
  /** The remote draft against the live agent (the platform's own diff). */
  readonly draftVsLive: DraftDiff;
}

/** T3.1.3 - `revition agents diff <file>`: what the file would change in the draft, and the draft against live. */
export default class AgentsDiff extends RevitionCommand<Out> {
  static override summary = 'Show what a definition file changes in the draft (by section), and the draft against live.';
  static override examples = ['revition agents diff agents/support.agent.yaml', 'revition agents diff agents/support.agent.yaml --json'];
  static meta: CommandMeta = {
    id: 'agents:diff',
    summary: AgentsDiff.summary,
    examples: AgentsDiff.examples,
    requiredScopes: ['cli:agents'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.agents.diff.v1',
    stability: 'beta',
  };
  static override args = { file: Args.string({ required: true, description: 'The definition file.' }) };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const { definition } = readDefinition(resolve(projectDir(), String(ctx.args['file'])));
    const id = definition.agent.id;
    if (id === null) throw usageError('NO_AGENT_ID', 'This file names no agent yet (agent.id is null).', 'Create the agent with `revition agents create <file>`.');
    const api = await agentsApi(ctx);
    const draft = await getDraft(api, id);
    const vsDraft = diffBySection({ config: draft.config, sections: draft.sections }, definition.config);
    const draftVsLive = (await api.request<DraftDiff>({ method: 'GET', path: `/deployments/${seg(id)}/draft/diff` })).body;
    return { agentId: id, vsDraft, draftVsLive };
  }

  protected override human(o: Out): HumanView {
    const d = o.vsDraft;
    const local = isEmptyDiff(d)
      ? ['File vs draft: no changes.']
      : ['File vs draft:', ...d.added.map((s) => `  + ${s}`), ...d.removed.map((s) => `  - ${s}`), ...d.changed.map((s) => `  ~ ${s}`)];
    const live = o.draftVsLive;
    return { text: `${[...local, `Draft vs live: ${live.changedSections.join(', ') || 'no difference'}`].join('\n')}\n` };
  }
}
