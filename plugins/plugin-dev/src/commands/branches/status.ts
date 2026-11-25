import { Args } from '@oclif/core';
import { RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi } from '../../api.js';
import { branchReviewUrl, type PipelineStageRow } from '../deploy.js';

import { agentFlag, findCodeBranch } from './list.js';

interface Out {
  readonly agentId: string;
  readonly branchId: string;
  readonly status: string;
  readonly reviewedBy: string | null;
  readonly pipeline: readonly PipelineStageRow[];
  readonly artifactRef: string | null;
  readonly reviewUrl: string;
}

/** T2.3.2 - where a branch stands. Approval and merge happen in the portal (Relay); the CLI only shows them. */
export default class BranchesStatus extends RevitionCommand<Out> {
  static override summary = "A code branch's review status and pipeline (approve and merge happen in the portal).";
  static override examples = ['revition branches status br_1 --agent dep_123', 'revition branches status br_1 --agent dep_123 --json'];
  static meta: CommandMeta = {
    id: 'branches:status',
    summary: BranchesStatus.summary,
    examples: BranchesStatus.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.branches.status.v1',
    stability: 'stable',
  };
  static override args = { branch: Args.string({ required: true, description: 'The branch id.' }) };
  static override flags = { agent: agentFlag };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const agentId = String(ctx.commandFlags['agent']);
    const b = await findCodeBranch(await devApi(ctx), agentId, String(ctx.args['branch']));
    return {
      agentId,
      branchId: b.branchId,
      status: b.status,
      reviewedBy: b.reviewedBy ?? null,
      pipeline: b.pipeline ?? [],
      artifactRef: b.artifactRef ?? null,
      reviewUrl: branchReviewUrl(agentId),
    };
  }

  protected override human(o: Out): HumanView {
    const stages = o.pipeline.map((s) => `${s.stage}: ${s.status}`).join(', ');
    return {
      text: `${[
        `${o.branchId}: ${o.status}${o.reviewedBy === null ? '' : ` (reviewed by ${o.reviewedBy})`}`,
        ...(stages === '' ? [] : [`pipeline: ${stages}`]),
        ...(o.artifactRef === null ? [] : [`artifact: ${o.artifactRef}`]),
        `review in the portal: ${o.reviewUrl}`,
      ].join('\n')}\n`,
    };
  }
}
