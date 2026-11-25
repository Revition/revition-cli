import { DEVELOPER_PORTAL_URL } from '../api.js';

/**
 * T2.3.1 - `revition eval`: the platform's evaluation quote, run record and job, and their terminal rendering. The
 * report is the portal's own (apps/web eval-console `EvalRunView`): the same verdict words, pass rate and billed
 * credits, which come from the server (Mint) and are never computed here.
 */
export interface EvalQuote {
  readonly quoteId: string;
  readonly appId: string;
  readonly projectId: string;
  readonly suiteId: string;
  readonly digest: string;
  readonly cases: number;
  readonly modelCalls: number;
  readonly estCredits: number | null;
  readonly balanceCredits: number | null;
}

export interface UpliftReport {
  readonly capabilityId: string;
  readonly version: string;
  readonly suiteId: string;
  readonly baseline: Readonly<Record<string, number>>;
  readonly withCapability: Readonly<Record<string, number>>;
  readonly delta: Readonly<Record<string, number>>;
  readonly verdict: 'improves' | 'neutral' | 'regresses';
}

export interface EvalRun {
  readonly runId: string;
  readonly appId: string;
  readonly suiteId: string;
  readonly projectId: string;
  readonly projectVersion: number;
  readonly digest: string;
  readonly report: UpliftReport;
  readonly passRate: number;
  readonly cases: number;
  readonly at: string;
  readonly billedCredits?: number;
}

export type EvalJob =
  | { readonly jobId: string; readonly status: 'running'; readonly at: string }
  | { readonly jobId: string; readonly status: 'done'; readonly runId: string; readonly at: string }
  | { readonly jobId: string; readonly status: 'failed'; readonly error: string; readonly at: string };

/** The portal's verdict words (eval-console.tsx VERDICT). */
export const VERDICT: Readonly<Record<UpliftReport['verdict'], string>> = {
  improves: 'Improves the agent',
  neutral: 'Neutral: no dimension moved',
  regresses: 'Regresses the agent',
};

/** Where the developer reads the same run on the web. */
export const EVAL_PORTAL_URL = `${DEVELOPER_PORTAL_URL}/apps`;

export function quoteText(q: EvalQuote): string {
  const cost =
    q.estCredits === null
      ? 'the exact amount is billed to your developer wallet after the run'
      : `about ${q.estCredits} credits`;
  const balance = q.balanceCredits === null ? 'unknown' : `${q.balanceCredits} credits`;
  return [
    `quote ${q.quoteId}: suite ${q.suiteId} on project ${q.projectId}`,
    `  ${q.cases} cases, ${q.modelCalls} model calls (each case without, then with the capability)`,
    `  cost: ${cost}; balance: ${balance}`,
  ].join('\n');
}

/** The run as the portal shows it: the headline, then each dimension without vs with the capability. */
export function reportText(r: EvalRun): string {
  const billed = r.billedCredits === undefined ? '' : ` · Billed: ${r.billedCredits} credits`;
  const head =
    `${VERDICT[r.report.verdict]} · ${r.suiteId} · ${r.cases} cases · ` +
    `pass rate ${(r.passRate * 100).toFixed(0)}% with the capability${billed}`;
  const rows = Object.keys(r.report.withCapability).map((d) => {
    const without = r.report.baseline[d];
    const delta = r.report.delta[d];
    return (
      `  ${d} without the capability: ${without === undefined ? '-' : without.toFixed(3)}` +
      ` | with it: ${(r.report.withCapability[d] ?? 0).toFixed(3)}` +
      ` | delta ${delta === undefined ? '-' : `${delta >= 0 ? '+' : ''}${delta.toFixed(3)}`}`
    );
  });
  return [head, ...rows, `run ${r.runId} · ${EVAL_PORTAL_URL}`].join('\n');
}

/**
 * After a timed-out run call: the newest run of this suite on this exact snapshot, if the run landed (the list is
 * newest first). PURE.
 */
export function landedRun(runs: readonly EvalRun[], suiteId: string, digest: string): EvalRun | null {
  return runs.find((r) => r.suiteId === suiteId && r.digest === digest) ?? null;
}
