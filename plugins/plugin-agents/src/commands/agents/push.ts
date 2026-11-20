import { resolve } from 'node:path';

import { Args } from '@oclif/core';
import { EXIT, RevitionCliError, RevitionCommand, usageError, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { draftBody } from '../../format.js';

import { agentsApi, bodyHash, getDraft, projectDir, readDefinition, readPullRecord, seg, writePullRecord } from './list.js';

export interface DraftDiff {
  readonly changedSections: readonly string[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly hasUnsavedChanges?: boolean;
}

interface Out {
  readonly agentId: string;
  readonly saved: boolean;
  readonly version: number;
  /** The draft against the live agent, after the save (GET .../draft/diff). */
  readonly vsLive: DraftDiff | null;
}

/**
 * T3.1.3 - `revition agents push <file>`: validate, then save the DRAFT (PUT .../draft) with the version the file was
 * pulled at (`baseVersion`): a draft changed since then is refused (409 AGENT_DRAFT_CONFLICT, exit 6) and nothing is
 * overwritten. A file equal to the draft is "no changes" and nothing is sent. The live agent never changes here: going
 * live is a human step in the portal (D9).
 */
export default class AgentsPush extends RevitionCommand<Out> {
  static override summary = "Save a definition file to the agent's draft (never live; publishing is done in the portal).";
  static override examples = ['revition agents push agents/support.agent.yaml', 'revition agents push agents/support.agent.yaml --yes --json'];
  static meta: CommandMeta = {
    id: 'agents:push',
    summary: AgentsPush.summary,
    examples: AgentsPush.examples,
    requiredScopes: ['cli:agents'],
    mutates: true,
    confirm: 'prompt',
    jsonSchemaId: 'revition.agents.push.v1',
    stability: 'beta',
  };
  static override args = { file: Args.string({ required: true, description: 'The definition file.' }) };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const dir = projectDir();
    const { definition, warnings } = readDefinition(resolve(dir, String(ctx.args['file'])));
    for (const w of warnings) ctx.warn(`${w.path}: ${w.message}`);
    const id = definition.agent.id;
    if (id === null) throw usageError('NO_AGENT_ID', 'This file names no agent yet (agent.id is null).', 'Create the agent with `revition agents create <file>`.');
    const api = await agentsApi(ctx);
    const current = await getDraft(api, id);
    const record = readPullRecord(dir, id);
    if (bodyHash(definition.config) === bodyHash({ config: current.config, sections: current.sections })) {
      return { agentId: id, saved: false, version: current.version, vsLive: null };
    }
    let version: number;
    try {
      const res = await api.request<{ draft: { version: number } }>({ method: 'PUT', path: `/deployments/${seg(id)}/draft`, body: draftBody(definition, record?.version ?? current.version) });
      version = res.body.draft.version;
    } catch (e) {
      if (e instanceof RevitionCliError && e.error.code === 'AGENT_DRAFT_CONFLICT') {
        throw new RevitionCliError(
          { ...e.error, message: 'The draft was changed by someone else since you pulled it; nothing was overwritten.', hint: `Run \`revition agents pull ${id} --force\` into a copy, re-apply your change, then push again.` },
          EXIT.conflict
        );
      }
      throw e;
    }
    await writePullRecord(dir, { agentId: id, version, bodyHash: bodyHash(definition.config) });
    const vsLive = (await api.request<DraftDiff>({ method: 'GET', path: `/deployments/${seg(id)}/draft/diff` })).body;
    return { agentId: id, saved: true, version, vsLive };
  }

  protected override human(o: Out): HumanView {
    if (!o.saved) return { text: `No changes: ${o.agentId}'s draft already matches the file.\n` };
    const d = o.vsLive;
    const changes = d === null ? '' : `Draft vs live: ${[...d.changedSections].join(', ') || 'no difference'}.\n`;
    return { text: `Saved the draft of ${o.agentId} (version ${o.version}).\n${changes}Go live in the portal: revition agents open ${o.agentId} --action publish\n` };
  }
}
