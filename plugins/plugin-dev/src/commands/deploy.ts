import { resolve } from 'node:path';

import { Flags } from '@oclif/core';
import { EXIT, RevitionCliError, RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi, seg } from '../api.js';
import { readProjectDir } from '../project/read-project.js';

/**
 * T2.3.2 - `revition deploy`: the legacy CLI's branch proposal (the same request), never a live change. The platform
 * lands the project as a code branch on the agent with its impact analysis; an Owner or Admin reviews it in the
 * portal (Relay), which is the only place a branch is approved or merged.
 */
export interface ImpactDelta {
  readonly expanded: readonly string[];
  readonly reduced: readonly string[];
}

/** The platform's impact of a proposed change (foundry distribution/pr-impact.ts PrImpact). */
export interface BranchImpact {
  readonly permission: ImpactDelta & { readonly needsApproval?: readonly string[] };
  readonly data: ImpactDelta;
  readonly ai: readonly string[];
  readonly ui: readonly string[];
  readonly cost: readonly string[];
  readonly security: readonly string[];
  readonly risky: boolean;
  readonly flags: readonly string[];
}

export interface ProposedBranch {
  readonly branch: string;
  readonly branchId: string;
  readonly files: readonly string[];
  readonly testsAdded?: readonly string[];
  readonly permissionDiff: readonly { readonly permission: string }[];
  readonly impact?: BranchImpact;
}

export interface PipelineStageRow {
  readonly stage: string;
  readonly status: string;
  readonly detail: string;
}

/** One branch as GET /deployments/{id}/code-branches lists it (coding-agent.ts CodeBranch). */
export interface CodeBranchView extends ProposedBranch {
  readonly agentId: string;
  readonly origin: string;
  readonly summary: string;
  readonly status: string;
  readonly createdAt: string;
  readonly reviewedBy?: string;
  readonly pipeline?: readonly PipelineStageRow[];
  readonly artifactRef?: string | null;
  readonly history?: readonly { readonly at: string; readonly by: string; readonly event: string }[];
}

/** The portal screen where an Owner or Admin reviews the agent's code branches (the agent editor's capabilities). */
export function branchReviewUrl(agentId: string): string {
  return `https://app.revition.com/foundry/agents/${encodeURIComponent(agentId)}/edit?section=apps_capabilities_plugins`;
}

/** The server's impact summary: the verdict, then each dimension that moved, then every flag. */
export function impactLines(impact: BranchImpact | undefined): string[] {
  if (impact === undefined) return ['impact: not reported by the server'];
  const delta = (d: ImpactDelta): string => [...d.expanded.map((x) => `+${x}`), ...d.reduced.map((x) => `-${x}`)].join(', ');
  const rows: [string, string][] = [
    ['permission', delta(impact.permission)],
    ['data', delta(impact.data)],
    ['ai', impact.ai.join(', ')],
    ['ui', impact.ui.join(', ')],
    ['cost', impact.cost.join(', ')],
    ['security', impact.security.join(', ')],
  ];
  return [
    `impact: ${impact.risky ? 'flagged: the reviewer must look before merging' : 'no flags'}`,
    ...rows.filter(([, v]) => v !== '').map(([k, v]) => `  ${k}: ${v}`),
    ...impact.flags.map((f) => `  flag: ${f}`),
  ];
}

interface Out extends ProposedBranch {
  readonly agentId: string;
  readonly reviewUrl: string;
}

export default class Deploy extends RevitionCommand<Out> {
  static override summary = 'Propose this project onto an agent as a code branch for review (never a live change).';
  static override examples = ['revition deploy --agent dep_123 --yes', 'revition deploy --agent dep_123 --dir ./my-ext --json --yes'];
  static meta: CommandMeta = {
    id: 'deploy',
    summary: Deploy.summary,
    examples: Deploy.examples,
    requiredScopes: ['cli:submit'],
    mutates: true,
    confirm: 'prompt',
    jsonSchemaId: 'revition.deploy.v1',
    stability: 'stable',
  };
  static override flags = {
    agent: Flags.string({ description: 'The agent (deployment id) to propose the branch on.', required: true }),
    dir: Flags.string({ description: 'The project directory (default: the current directory).' }),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const agentId = String(ctx.commandFlags['agent']);
    const dir = resolve(process.cwd(), typeof ctx.commandFlags['dir'] === 'string' ? ctx.commandFlags['dir'] : '.');
    const files = readProjectDir(dir);
    const api = await devApi(ctx);
    let b: ProposedBranch;
    try {
      b = (await api.request<ProposedBranch>({ method: 'POST', path: `/deployments/${seg(agentId)}/code-branches`, body: { mode: 'cli', files } })).body;
    } catch (e) {
      if (e instanceof RevitionCliError && e.exitCode === EXIT.permission) {
        throw new RevitionCliError(
          { ...e.error, hint: `Proposing code needs edit access to agent ${agentId}: ask an Owner or Admin of its workspace to grant it.` },
          EXIT.permission
        );
      }
      throw e;
    }
    return { ...b, agentId, reviewUrl: branchReviewUrl(agentId) };
  }

  protected override human(o: Out): HumanView {
    return {
      text: `${[
        `proposed ${o.branch} (${o.branchId}) with ${o.files.join(', ')}`,
        ...o.permissionDiff.map((p) => `  needs ${p.permission}: an Owner or Admin must grant it`),
        ...impactLines(o.impact),
        `review: ${o.reviewUrl}`,
        `Next: an Owner or Admin reviews the branch; then revition branches eval ${o.branchId} --agent ${o.agentId}`,
      ].join('\n')}\n`,
    };
  }
}
