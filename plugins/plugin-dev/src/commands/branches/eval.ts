import { Args } from '@oclif/core';
import {
  canPrompt,
  confirmYes,
  EXIT,
  RevitionCliError,
  RevitionCommand,
  type ApiClient,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

import { devApi, seg } from '../../api.js';
import type { PipelineStageRow } from '../deploy.js';

import { agentFlag, listCodeBranches } from './list.js';

/**
 * T2.3.2 / T2.3.1 AC4 - the legacy `revition eval --agent a --branch b`, kept with parity: the pipeline quote, then
 * (confirmed) the pipeline on an approved branch (build, scan, sandbox tests, evaluation). The platform refuses an
 * unapproved branch. A 202 runs in the background: the branch is read again until no stage is running.
 */
export const PIPELINE_POLL_MS = 3_000;
export const PIPELINE_WAIT_MS = 15 * 60_000;

interface PipelineQuote {
  readonly quoteId: string;
  readonly sandboxRuns: number;
  readonly limits: Readonly<Record<string, number>>;
}

interface PipelineEnd {
  readonly artifactRef: string | null;
  readonly stages: readonly PipelineStageRow[];
  readonly promoted: boolean;
}

interface Out {
  readonly agentId: string;
  readonly branchId: string;
  readonly quote: PipelineQuote;
  readonly ran: boolean;
  readonly end: PipelineEnd | null;
  /** The quote line was already shown above the interactive prompt. */
  readonly quoteShown: boolean;
}

/** The legacy canonical JSON (sorted keys), for the quote's limits. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

const quoteLine = (q: PipelineQuote): string => `quote ${q.quoteId}: ${q.sandboxRuns} sandbox test run(s) at ${canonical(q.limits)}`;

/** Promoted only when the evaluation stage passed (an artifactRef alone is not a promotion; legacy F5). */
const evaluationPassed = (stages: readonly PipelineStageRow[]): boolean =>
  stages.some((s) => s.stage === 'evaluation' && s.status === 'passed');

function promotedRef(r: PipelineEnd): string | null {
  const ref = typeof r.artifactRef === 'string' && r.artifactRef !== '' ? r.artifactRef : null;
  return r.promoted ? ref : null;
}

function endLine(r: PipelineEnd): string {
  const promoted = promotedRef(r);
  if (promoted !== null) return `promoted to test as ${promoted}`;
  const ref = typeof r.artifactRef === 'string' && r.artifactRef !== '' ? r.artifactRef : null;
  const why = r.stages.find((s) => s.stage === 'evaluation' && s.status !== 'passed')?.detail ?? '';
  const reason = why === '' ? '' : `: ${why}`;
  return ref === null ? `not promoted${reason}` : `frozen as ${ref}; not promoted${reason}`;
}

async function awaitBackground(api: ApiClient, agentId: string, branchId: string): Promise<PipelineEnd | null> {
  for (let waited = 0; waited <= PIPELINE_WAIT_MS; waited += PIPELINE_POLL_MS) {
    await new Promise((r) => setTimeout(r, PIPELINE_POLL_MS));
    const b = (await listCodeBranches(api, agentId)).find((x) => x.branchId === branchId);
    const stages = b?.pipeline ?? [];
    if (b !== undefined && stages.length > 0 && !stages.some((s) => s.status === 'running')) {
      return { artifactRef: b.artifactRef ?? null, stages, promoted: b.status === 'promoted' };
    }
  }
  return null;
}

export default class BranchesEval extends RevitionCommand<Out> {
  static override summary = 'Run the pipeline on an approved code branch: the quote first, then (confirmed) the run.';
  static override examples = ['revition branches eval br_1 --agent dep_123', 'revition branches eval br_1 --agent dep_123 --yes'];
  static meta: CommandMeta = {
    id: 'branches:eval',
    summary: BranchesEval.summary,
    examples: BranchesEval.examples,
    requiredScopes: ['cli:write'],
    // Quote first: the confirmation comes after the quote is shown, so the command confirms itself.
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.branches.eval.v1',
    stability: 'stable',
    paid: { quote: 'required' },
  };
  static override args = { branch: Args.string({ required: true, description: 'The branch id.' }) };
  static override flags = { agent: agentFlag };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const agentId = String(ctx.commandFlags['agent']);
    const branchId = String(ctx.args['branch']);
    const api = await devApi(ctx);
    const base = `/deployments/${seg(agentId)}/code-branches/${seg(branchId)}`;
    const quote = (await api.request<PipelineQuote>({ method: 'GET', path: `${base}/pipeline-quote` })).body;
    let quoteShown = false;
    if (!ctx.flags.yes) {
      // Legacy: without --yes nothing runs (the quote is the answer). Interactive: the quote, then the question.
      if (!canPrompt(ctx.io, { json: ctx.flags.json, noInput: ctx.flags.noInput })) return { agentId, branchId, quote, ran: false, end: null, quoteShown };
      ctx.io.err(`${quoteLine(quote)}\n`);
      quoteShown = true;
      if (!(await confirmYes(ctx.io, 'Run the pipeline against this quote?'))) throw new RevitionCliError({ code: 'CANCELLED', message: 'Cancelled.' }, EXIT.cancelled);
    }
    const ran = (await api.request<{ artifactRef?: string | null; stages: PipelineStageRow[] }>({ method: 'POST', path: `${base}/pipeline`, body: { quoteId: quote.quoteId } })).body;
    const end = 'artifactRef' in ran ? { artifactRef: ran.artifactRef ?? null, stages: ran.stages, promoted: evaluationPassed(ran.stages) } : await awaitBackground(api, agentId, branchId);
    if (end === null) {
      throw new RevitionCliError(
        { code: 'PIPELINE_STILL_RUNNING', message: `the pipeline is still running after ${PIPELINE_WAIT_MS / 60_000} min; re-read the branch later`, hint: `Run \`revition branches status ${branchId} --agent ${agentId}\`.` },
        EXIT.general
      );
    }
    if (promotedRef(end) === null) ctx.setExitCode?.(EXIT.general);
    return { agentId, branchId, quote, ran: true, end, quoteShown };
  }

  protected override human(o: Out): HumanView {
    const lines = o.quoteShown ? [] : [quoteLine(o.quote)];
    if (!o.ran || o.end === null) {
      lines.push('Nothing ran. Re-run with --yes to run the pipeline against this quote.');
    } else {
      for (const s of o.end.stages) lines.push(`${s.stage}: ${s.status}${s.detail === '' ? '' : ` (${s.detail})`}`);
      lines.push(endLine(o.end));
    }
    return { text: `${lines.join('\n')}\n` };
  }
}
