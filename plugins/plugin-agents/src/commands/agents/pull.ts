import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Args, Flags } from '@oclif/core';
import { atomicWriteFile, EXIT, RevitionCliError, RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { DEFINITION_SUFFIX, definitionFromDraft, definitionText, parseDefinitionText, type AgentDefinition } from '../../format.js';

import { agentsApi, bodyHash, getDraft, projectDir, readPullRecord, seg, writePullRecord, type Deployment } from './list.js';

/** `agents/<slug>.agent.yaml` from the agent's name. PURE. */
export function defaultDefinitionPath(dir: string, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
  return join(dir, 'agents', `${slug}${DEFINITION_SUFFIX}`);
}

interface Out {
  readonly agentId: string;
  readonly file: string;
  readonly version: number;
  readonly written: boolean;
}

/**
 * T3.1.3 - `revition agents pull <id> [-o file] [--force]`: the agent's current draft as a definition file (references
 * only; the server never returns a secret value). An existing file that was edited since the last pull is not
 * overwritten without --force.
 */
export default class AgentsPull extends RevitionCommand<Out> {
  static override summary = "Write an agent's draft to a definition file (keeps your local edits unless --force).";
  static override examples = ['revition agents pull dep_123', 'revition agents pull dep_123 -o agents/support.agent.yaml --force'];
  static meta: CommandMeta = {
    id: 'agents:pull',
    summary: AgentsPull.summary,
    examples: AgentsPull.examples,
    requiredScopes: ['cli:agents'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.agents.pull.v1',
    stability: 'beta',
  };
  static override args = { id: Args.string({ required: true, description: 'The agent (deployment id).' }) };
  static override flags = {
    output: Flags.string({ char: 'o', description: 'The file to write (default: agents/<name>.agent.yaml).' }),
    force: Flags.boolean({ description: 'Overwrite a file that has local edits.' }),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const id = String(ctx.args['id']);
    const dir = projectDir();
    const api = await agentsApi(ctx);
    const agent = (await api.request<Deployment>({ method: 'GET', path: `/deployments/${seg(id)}` })).body;
    const draft = await getDraft(api, id);
    const def = definitionFromDraft({ id, name: agent.name }, draft);
    const out = typeof ctx.commandFlags['output'] === 'string' ? resolve(dir, ctx.commandFlags['output']) : defaultDefinitionPath(dir, agent.name);
    if (existsSync(out) && ctx.commandFlags['force'] !== true && locallyEdited(out, dir, id, def)) {
      throw new RevitionCliError(
        { code: 'LOCAL_CHANGES', message: `${out} has changes since the last pull; not overwritten.`, hint: 'Push them first (`revition agents push`), or re-run with --force to discard them.' },
        EXIT.conflict
      );
    }
    await atomicWriteFile(out, definitionText(def));
    await writePullRecord(dir, { agentId: id, version: draft.version, bodyHash: bodyHash(def.config) });
    return { agentId: id, file: out, version: draft.version, written: true };
  }

  protected override human(o: Out): HumanView {
    return { text: `Pulled ${o.agentId} (draft version ${o.version}) to ${o.file}.\n` };
  }
}

/** The file differs from what was last pulled (and from the remote draft): it holds edits a pull would lose. */
function locallyEdited(file: string, dir: string, id: string, remote: AgentDefinition): boolean {
  let local: AgentDefinition;
  try {
    local = parseDefinitionText(readFileSync(file, 'utf8')) as AgentDefinition;
  } catch {
    return true;
  }
  const localHash = bodyHash(local.config ?? { config: {}, sections: {} });
  if (localHash === bodyHash(remote.config)) return false;
  const record = readPullRecord(dir, id);
  return record === null || record.bodyHash !== localHash;
}
