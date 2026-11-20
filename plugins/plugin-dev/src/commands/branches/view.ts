import { Args } from '@oclif/core';
import { RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi } from '../../api.js';
import { branchReviewUrl, impactLines, type CodeBranchView } from '../deploy.js';

import { agentFlag, findCodeBranch } from './list.js';

interface Out extends CodeBranchView {
  readonly reviewUrl: string;
}

export default class BranchesView extends RevitionCommand<Out> {
  static override summary = 'Show one code branch: its files, permissions, impact, pipeline and history.';
  static override examples = ['revition branches view br_1 --agent dep_123'];
  static meta: CommandMeta = {
    id: 'branches:view',
    summary: BranchesView.summary,
    examples: BranchesView.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.branches.view.v1',
    stability: 'stable',
  };
  static override args = { branch: Args.string({ required: true, description: 'The branch id.' }) };
  static override flags = { agent: agentFlag };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const agentId = String(ctx.commandFlags['agent']);
    const b = await findCodeBranch(await devApi(ctx), agentId, String(ctx.args['branch']));
    return { ...b, reviewUrl: branchReviewUrl(agentId) };
  }

  protected override human(b: Out): HumanView {
    return {
      text: `${[
        `${b.branch} (${b.branchId}) - ${b.status}${b.reviewedBy === undefined ? '' : ` by ${b.reviewedBy}`}`,
        `summary: ${b.summary}`,
        `files: ${b.files.join(', ')}`,
        ...b.permissionDiff.map((p) => `  needs ${p.permission}: an Owner or Admin must grant it`),
        ...impactLines(b.impact),
        ...(b.pipeline ?? []).map((s) => `${s.stage}: ${s.status}${s.detail === '' ? '' : ` (${s.detail})`}`),
        ...(b.history ?? []).map((h) => `  ${h.at} ${h.by}: ${h.event}`),
        `review: ${b.reviewUrl}`,
      ].join('\n')}\n`,
    };
  }
}
