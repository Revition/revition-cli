import { Flags } from '@oclif/core';
import { RevitionCommand, renderTable, terminalTable, usageError, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi } from '../../api.js';
import { listAppRuns, type RunSummary } from '../logs.js';
import { appOf } from '../submit.js';

/** `--since 30m|6h|7d|90s` -> milliseconds; null when not given. PURE. */
export function parseDuration(v: unknown): number | null {
  if (v === undefined) return null;
  const m = typeof v === 'string' ? /^(\d+)(s|m|h|d)$/.exec(v) : null;
  if (m === null) throw usageError('INVALID_DURATION', `--since "${String(v)}" is not a duration.`, 'Use e.g. 90s, 30m, 6h or 7d.');
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd'];
  return Number(m[1]) * unit;
}

/** The server's list, filtered here (the route takes no query parameters). PURE. */
export function filterRuns(runs: readonly RunSummary[], f: { readonly ok: boolean; readonly failed: boolean; readonly sinceMs: number | null; readonly nowMs: number }): RunSummary[] {
  return runs.filter(
    (r) =>
      (!f.ok || r.ok) && (!f.failed || !r.ok) && (f.sinceMs === null || Date.parse(r.at) >= f.nowMs - f.sinceMs)
  );
}

interface Out {
  readonly appId: string;
  readonly runs: readonly RunSummary[];
  readonly notes: readonly string[];
}

export default class RunsList extends RevitionCommand<Out> {
  static override summary = "An app's runs (builds, runs in agents, evaluations), newest first.";
  static override examples = ['revition runs list --app dapp_123', 'revition runs list --failed --since 7d', 'revition runs list --json'];
  static meta: CommandMeta = {
    id: 'runs:list',
    summary: RunsList.summary,
    examples: RunsList.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.runs.list.v1',
    stability: 'stable',
  };
  static override flags = {
    app: Flags.string({ description: 'The app id (default: the linked app).' }),
    dir: Flags.string({ description: 'The project directory (default: the current directory).' }),
    ok: Flags.boolean({ description: 'Only the runs that succeeded.', exclusive: ['failed'] }),
    failed: Flags.boolean({ description: 'Only the runs that failed.', exclusive: ['ok'] }),
    since: Flags.string({ description: 'Only the runs newer than this (90s, 30m, 6h, 7d).' }),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const f = ctx.commandFlags;
    const appId = appOf(ctx);
    const sinceMs = parseDuration(f['since']);
    const all = await listAppRuns(await devApi(ctx), appId);
    return { appId, runs: filterRuns(all.runs, { ok: f['ok'] === true, failed: f['failed'] === true, sinceMs, nowMs: Date.now() }), notes: all.notes };
  }

  protected override human(o: Out): HumanView {
    const notes = o.notes.map((n) => `${n}.\n`).join('');
    if (o.runs.length === 0) return { text: `${notes}No runs of ${o.appId} match.\n` };
    return {
      text: `${notes}${renderTable(
        ['run', 'kind', 'ok', 'at', 'what'],
        o.runs.map((r) => [r.runId, r.kind, r.ok ? 'yes' : 'no', r.at, r.label]),
        terminalTable()
      )}`,
    };
  }
}
