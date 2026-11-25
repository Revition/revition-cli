import { Args, Flags } from '@oclif/core';
import {
  redactValue,
  RevitionCommand,
  usageError,
  type ApiClient,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

import { devApi, seg } from '../api.js';

import { appOf } from './submit.js';

/**
 * T2.4.1 - `revition logs`: one run's logs as the portal shows them (devportal debug-panel.tsx LogBundle): the notes,
 * the build log, the execution events (metadata only), the errors with the extension's own frames, the eval log and
 * how many fields were withheld (never guessed). `--follow` polls the run list and prints each NEW run once.
 */
export interface RunSummary {
  readonly runId: string;
  readonly kind: 'build' | 'execution' | 'eval';
  readonly at: string;
  readonly ok: boolean;
  readonly label: string;
}

export interface LogBundle {
  readonly runId: string;
  readonly kind: RunSummary['kind'];
  readonly build: readonly string[];
  readonly exec: readonly {
    readonly at: string;
    readonly node: string;
    readonly status: string | null;
    readonly durationMs: number | null;
    readonly attributes: Readonly<Record<string, string | number | boolean>>;
  }[];
  readonly errors: readonly { readonly at: string; readonly kind: string; readonly frames: readonly string[] }[];
  readonly eval: readonly string[];
  readonly withheld: number;
  readonly notes: readonly string[];
}

export const FOLLOW_MIN_MS = 5_000;
export const FOLLOW_MAX_MS = 30_000;

/** The portal's rendering, as lines. PURE. */
export function logLines(b: LogBundle): string[] {
  const empty = b.build.length === 0 && b.exec.length === 0 && b.errors.length === 0 && b.eval.length === 0;
  const lines = [`run ${b.runId} (${b.kind})`, ...b.notes.map((n) => `  ${n}.`)];
  if (empty && b.notes.length === 0) lines.push('  This run has no logs.');
  if (b.build.length > 0) lines.push('Build log', ...b.build.map((l) => `  ${l}`));
  if (b.exec.length > 0) {
    lines.push('Execution');
    for (const e of b.exec) {
      const details = Object.entries(e.attributes)
        .filter(([k]) => k !== 'status' && k !== 'durationMs')
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(' ');
      const dur = e.durationMs === null ? '-' : `${e.durationMs} ms`;
      lines.push(`  ${e.at.slice(11, 19)} ${e.node} ${e.status ?? '-'} ${dur}${details === '' ? '' : ` ${details}`}`);
    }
  }
  if (b.errors.length > 0) {
    lines.push('Errors');
    for (const e of b.errors) lines.push(`  ${e.kind}`, ...e.frames.map((f) => `    ${f}`));
  }
  if (b.eval.length > 0) lines.push('Eval log', ...b.eval.map((l) => `  ${l}`));
  if (b.withheld > 0) {
    lines.push(`${b.withheld} ${b.withheld === 1 ? 'field was' : 'fields were'} withheld: you see a run's execution metadata, never a customer's data.`);
  }
  return lines;
}

/** `--grep` (local): the matching lines, under the run's header. PURE. */
export function grepLines(lines: readonly string[], term: string | null): string[] {
  if (term === null) return [...lines];
  const t = term.toLowerCase();
  const hits = lines.slice(1).filter((l) => l.toLowerCase().includes(t));
  return hits.length === 0 ? [] : [lines[0] ?? '', ...hits];
}

export interface FollowDeps {
  readonly listRuns: () => Promise<readonly RunSummary[]>;
  readonly logs: (runId: string) => Promise<LogBundle>;
  readonly emit: (run: RunSummary, bundle: LogBundle) => void;
  readonly sleep: (ms: number) => Promise<void>;
}

/**
 * The follow loop: the runs already there are the baseline; every later poll prints each run not seen before ONCE
 * (dedupe by runId) and waits 5 s, doubling to 30 s while nothing new arrives. `maxPolls` bounds it (tests); the
 * command follows until Ctrl-C. Returns the run ids printed.
 */
export async function follow(deps: FollowDeps, maxPolls = Number.POSITIVE_INFINITY): Promise<string[]> {
  const seen = new Set((await deps.listRuns()).map((r) => r.runId));
  const printed: string[] = [];
  let wait = FOLLOW_MIN_MS;
  for (let poll = 0; poll < maxPolls; poll++) {
    await deps.sleep(wait);
    const fresh = (await deps.listRuns()).filter((r) => !seen.has(r.runId)).reverse();
    for (const r of fresh) {
      seen.add(r.runId);
      deps.emit(r, await deps.logs(r.runId));
      printed.push(r.runId);
    }
    wait = fresh.length > 0 ? FOLLOW_MIN_MS : Math.min(FOLLOW_MAX_MS, wait * 2);
  }
  return printed;
}

export async function listAppRuns(api: ApiClient, appId: string): Promise<{ runs: RunSummary[]; notes: string[] }> {
  const b = (await api.request<{ runs: RunSummary[]; notes?: string[] }>({ method: 'GET', path: `/dev/apps/${seg(appId)}/runs` })).body;
  return { runs: b.runs, notes: b.notes ?? [] };
}

async function runLogs(api: ApiClient, appId: string, runId: string): Promise<LogBundle> {
  return (await api.request<LogBundle>({ method: 'GET', path: `/dev/apps/${seg(appId)}/runs/${seg(runId)}/logs` })).body;
}

interface Out {
  readonly appId: string;
  readonly logs: LogBundle;
  readonly grep: string | null;
}

export default class Logs extends RevitionCommand<Out> {
  static override summary = "One run's logs (as the portal shows them), or --follow new runs as they happen.";
  static override examples = ['revition logs build:1.2.0 --app dapp_123', 'revition logs --app dapp_123 --follow', 'revition logs --follow --json | jq .runId'];
  static meta: CommandMeta = {
    id: 'logs',
    summary: Logs.summary,
    examples: Logs.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.logs.v1',
    stability: 'stable',
  };
  static override args = { runId: Args.string({ description: 'The run id (from `revition runs list`).' }) };
  static override flags = {
    app: Flags.string({ description: 'The app id (default: the linked app).' }),
    dir: Flags.string({ description: 'The project directory (default: the current directory).' }),
    follow: Flags.boolean({ description: 'Print each new run once as it happens, until Ctrl-C.' }),
    grep: Flags.string({ description: 'Only the lines containing this text (local).' }),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const appId = appOf(ctx);
    const grep = typeof ctx.commandFlags['grep'] === 'string' ? ctx.commandFlags['grep'] : null;
    const api = await devApi(ctx);
    const runId = ctx.args['runId'];
    if (ctx.commandFlags['follow'] === true) {
      ctx.io.err(`following the runs of ${appId}: new runs print as they happen (Ctrl-C to stop)\n`);
      await follow({
        listRuns: async () => (await listAppRuns(api, appId)).runs,
        logs: (id) => runLogs(api, appId, id),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        emit: (run, bundle) => {
          if (ctx.flags.json) {
            // NDJSON: one object per run, every string redacted before it is serialized.
            if (grepLines(logLines(bundle), grep).length > 0) ctx.io.out(`${JSON.stringify(redactValue({ run, logs: bundle }))}\n`);
          } else {
            const lines = grepLines(logLines(bundle), grep);
            if (lines.length > 0) ctx.io.out(`${lines.join('\n')}\n`);
          }
        },
      });
    }
    if (typeof runId !== 'string') throw usageError('RUN_REQUIRED', 'Which run? Pass a run id, or --follow.', 'Run `revition runs list` for the run ids.');
    return { appId, logs: await runLogs(api, appId, runId), grep };
  }

  protected override human(o: Out): HumanView {
    const lines = grepLines(logLines(o.logs), o.grep);
    return { text: lines.length === 0 ? `No lines of ${o.logs.runId} contain "${o.grep ?? ''}".\n` : `${lines.join('\n')}\n` };
  }
}
