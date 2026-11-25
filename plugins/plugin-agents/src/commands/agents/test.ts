import { Args } from '@oclif/core';
import {
  canPrompt,
  confirmYes,
  EXIT,
  RevitionCliError,
  RevitionCommand,
  usageError,
  type ApiClient,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

import { agentsApi, seg } from './list.js';

/**
 * T3.1.4 - `revition agents test <id>`: the draft's own Tests. The quote first (paid draft runs, free cases); a run
 * with paid calls needs confirmation (or --yes) and is sent with its quoteId (the server refuses it otherwise); a long
 * suite runs in the background and is followed to its report. The report is the portal's (GET .../tests/report).
 */
export interface TestsQuote {
  readonly quoteId: string;
  readonly draftVersion: number;
  readonly modelCalls: number;
  readonly verificationCalls?: number;
  readonly freeCases: number;
  readonly available: boolean;
  readonly billedEstimateUsd?: number | null;
}

export interface TestResult {
  readonly caseId: string;
  readonly type: string;
  readonly status: string;
  readonly passed: boolean;
  readonly detail?: string;
  readonly regressionOf?: string;
}

export interface TestsReport {
  readonly draftVersion: number;
  readonly results: readonly TestResult[];
  readonly regressionCount: number;
  readonly allPassed: boolean;
}

export interface RunState {
  readonly status: 'running' | 'finished' | 'failed' | 'refused';
  readonly done: number;
  readonly total: number;
  readonly reason?: string;
}

const POLL_MS = 3_000;
const WAIT_MS = 15 * 60_000;

/** The report as lines: the tally, each case, the regressions. PURE. */
export function reportLines(r: TestsReport): string[] {
  const passed = r.results.filter((x) => x.passed).length;
  return [
    `draft version ${r.draftVersion}: ${passed} of ${r.results.length} cases passed${r.allPassed ? '' : ' - not all passed'}`,
    ...r.results.map((x) => `  ${x.passed ? 'pass' : 'FAIL'} ${x.caseId} (${x.type}, ${x.status})${x.detail === undefined ? '' : `: ${x.detail}`}${x.regressionOf === undefined ? '' : ' [regression]'}`),
    ...(r.regressionCount > 0 ? [`${r.regressionCount} regression(s) since the last run`] : []),
  ];
}

export async function latestReport(api: ApiClient, id: string): Promise<{ report: TestsReport | null; run: RunState | null }> {
  return (await api.request<{ report: TestsReport | null; run: RunState | null }>({ method: 'GET', path: `/deployments/${seg(id)}/tests/report` })).body;
}

interface Out {
  readonly agentId: string;
  readonly quote: TestsQuote;
  readonly report: TestsReport;
}

export default class AgentsTest extends RevitionCommand<Out> {
  static override summary = "Run the agent draft's Tests: the quote first, then (confirmed) the run and the report.";
  static override examples = ['revition agents test dep_123', 'revition agents test dep_123 --yes --json'];
  static meta: CommandMeta = {
    id: 'agents:test',
    summary: AgentsTest.summary,
    examples: AgentsTest.examples,
    requiredScopes: ['cli:agents'],
    // Quote first: the confirmation comes after the quote is shown, so the command confirms itself.
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.agents.test.v1',
    stability: 'beta',
    paid: { quote: 'required' },
  };
  static override args = { id: Args.string({ required: true, description: 'The agent (deployment id).' }) };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const id = String(ctx.args['id']);
    const api = await agentsApi(ctx);
    const quote = (await api.request<TestsQuote>({ method: 'GET', path: `/deployments/${seg(id)}/tests/quote` })).body;
    if (!ctx.flags.json) {
      const cost = quote.billedEstimateUsd === undefined || quote.billedEstimateUsd === null ? 'billed after the run' : `about $${quote.billedEstimateUsd.toFixed(2)}`;
      ctx.io.err(`quote ${quote.quoteId}: ${quote.modelCalls} paid draft run(s), ${quote.freeCases} free case(s); ${cost}\n`);
    }
    if (quote.modelCalls > 0 && !quote.available) throw new RevitionCliError({ code: 'TESTS_UNAVAILABLE', message: 'Model-backed cases cannot run here.' }, EXIT.conflict);
    if (quote.modelCalls > 0 && !ctx.flags.yes) {
      if (!canPrompt(ctx.io, { json: ctx.flags.json, noInput: ctx.flags.noInput })) throw usageError('CONFIRMATION_REQUIRED', 'This test run makes paid calls and needs confirmation.', 'Re-run with --yes.');
      if (!(await confirmYes(ctx.io, 'Run the Tests (paid draft runs)?'))) throw new RevitionCliError({ code: 'CANCELLED', message: 'Cancelled.' }, EXIT.cancelled);
    }
    const ran = await api.request<TestsReport | { status: 'running' }>({ method: 'POST', path: `/deployments/${seg(id)}/tests/run`, body: { quoteId: quote.quoteId } });
    const report = ran.status === 202 ? await this.awaitReport(ctx, api, id) : (ran.body as TestsReport);
    if (!report.allPassed) ctx.setExitCode?.(EXIT.general);
    return { agentId: id, quote, report };
  }

  private async awaitReport(ctx: CommandContext, api: ApiClient, id: string): Promise<TestsReport> {
    ctx.io.err('running in the background\n');
    for (let waited = 0; waited <= WAIT_MS; waited += POLL_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const { report, run } = await latestReport(api, id);
      if (run?.status === 'finished' && report !== null) return report;
      if (run?.status === 'failed' || run?.status === 'refused') {
        throw new RevitionCliError({ code: 'TESTS_NOT_FINISHED', message: `The test run ${run.status}${run.reason === undefined ? '' : `: ${run.reason}`}.` }, EXIT.conflict);
      }
    }
    throw new RevitionCliError({ code: 'TESTS_STILL_RUNNING', message: 'The Tests are still running.', hint: `Run \`revition agents status ${id}\` later.` }, EXIT.network);
  }

  protected override human(o: Out): HumanView {
    return { text: `${reportLines(o.report).join('\n')}\n` };
  }
}
