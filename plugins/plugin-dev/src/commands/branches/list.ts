import { Flags } from '@oclif/core';
import {
  EXIT,
  RevitionCliError,
  RevitionCommand,
  renderTable,
  terminalTable,
  type ApiClient,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

import { devApi, seg } from '../../api.js';
import type { CodeBranchView } from '../deploy.js';

/** T2.3.2 - the agent's code branches (newest first), as the platform lists them. Read only. */
export async function listCodeBranches(api: ApiClient, agentId: string): Promise<readonly CodeBranchView[]> {
  const r = await api.request<{ branches?: CodeBranchView[] }>({ method: 'GET', path: `/deployments/${seg(agentId)}/code-branches` });
  return r.body.branches ?? [];
}

export async function findCodeBranch(api: ApiClient, agentId: string, branchId: string): Promise<CodeBranchView> {
  const b = (await listCodeBranches(api, agentId)).find((x) => x.branchId === branchId);
  if (b === undefined) {
    throw new RevitionCliError(
      { code: 'BRANCH_NOT_FOUND', message: `Agent ${agentId} has no branch ${branchId}.`, hint: `Run \`revition branches list --agent ${agentId}\`.` },
      EXIT.notFound
    );
  }
  return b;
}

export const agentFlag = Flags.string({ description: 'The agent (deployment id).', required: true });

interface Out {
  readonly agentId: string;
  readonly branches: readonly CodeBranchView[];
}

export default class BranchesList extends RevitionCommand<Out> {
  static override summary = "List an agent's code branches and their review status.";
  static override examples = ['revition branches list --agent dep_123', 'revition branches list --agent dep_123 --json'];
  static meta: CommandMeta = {
    id: 'branches:list',
    summary: BranchesList.summary,
    examples: BranchesList.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.branches.list.v1',
    stability: 'stable',
  };
  static override flags = { agent: agentFlag };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const agentId = String(ctx.commandFlags['agent']);
    return { agentId, branches: await listCodeBranches(await devApi(ctx), agentId) };
  }

  protected override human(o: Out): HumanView {
    if (o.branches.length === 0) return { text: `Agent ${o.agentId} has no code branches. Propose one with \`revition deploy\`.\n` };
    return {
      text: renderTable(
        ['branch', 'id', 'status', 'origin', 'created'],
        o.branches.map((b) => [b.branch, b.branchId, b.status, b.origin, b.createdAt.slice(0, 10)]),
        terminalTable()
      ),
    };
  }
}
