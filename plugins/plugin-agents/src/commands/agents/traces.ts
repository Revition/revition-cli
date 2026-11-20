import { Args, Flags } from '@oclif/core';
import { redactValue, RevitionCommand, renderTable, terminalTable, type ApiClient, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { agentsApi, seg } from './list.js';
import { allPages, scopeFlags, scopeQuery } from './runs.js';

/** One trace as GET /deployments/{id}/intelligence/traces lists it (foundry intelligence/traces-arena TraceRef). */
export interface TraceRef {
  readonly executionId: string;
  readonly taskId: string | null;
  readonly workTitle: string | null;
  readonly at: string;
  readonly status: string | null;
  readonly failed: boolean;
}

export const FOLLOW_MIN_MS = 5_000;
export const FOLLOW_MAX_MS = 30_000;

export interface TraceFollowDeps {
  readonly list: () => Promise<readonly TraceRef[]>;
  readonly emit: (t: TraceRef) => void;
  readonly sleep: (ms: number) => Promise<void>;
}

/**
 * `--follow`: the traces already in the window are the baseline; each later poll (every page, by the server's cursor)
 * prints every trace not seen before ONCE (dedupe by execution id), oldest first; 5 s, doubling to 30 s while nothing
 * new arrives. `maxPolls` bounds it (tests). Returns the execution ids printed.
 */
export async function followTraces(deps: TraceFollowDeps, maxPolls = Number.POSITIVE_INFINITY): Promise<string[]> {
  const seen = new Set((await deps.list()).map((t) => t.executionId));
  const printed: string[] = [];
  let wait = FOLLOW_MIN_MS;
  for (let poll = 0; poll < maxPolls; poll++) {
    await deps.sleep(wait);
    const fresh = (await deps.list()).filter((t) => !seen.has(t.executionId)).sort((a, b) => a.at.localeCompare(b.at));
    for (const t of fresh) {
      seen.add(t.executionId);
      deps.emit(t);
      printed.push(t.executionId);
    }
    wait = fresh.length > 0 ? FOLLOW_MIN_MS : Math.min(FOLLOW_MAX_MS, wait * 2);
  }
  return printed;
}

async function listTraces(api: ApiClient, id: string, query: Record<string, string>): Promise<TraceRef[]> {
  return allPages((cursor) =>
    api
      .request<{ items: TraceRef[]; nextCursor: string | null }>({ method: 'GET', path: `/deployments/${seg(id)}/intelligence/traces`, query: { ...query, ...(cursor === null ? {} : { cursor }) } })
      .then((r) => r.body)
  );
}

const line = (t: TraceRef): string => `${t.at} ${t.executionId} ${t.status ?? '-'}${t.failed ? ' FAILED' : ''}${t.workTitle === null ? '' : ` ${t.workTitle}`}`;

interface Out {
  readonly agentId: string;
  readonly traces: readonly TraceRef[];
}

/** T3.1.5 - `revition agents traces <id>`: the agent's traces for a scope and range (every page), or --follow. */
export default class AgentsTraces extends RevitionCommand<Out> {
  static override summary = "An agent's execution traces for a range, or --follow new ones as they happen.";
  static override examples = ['revition agents traces dep_123', 'revition agents traces dep_123 --from 2026-11-01 --to 2026-11-18', 'revition agents traces dep_123 --follow --json'];
  static meta: CommandMeta = {
    id: 'agents:traces',
    summary: AgentsTraces.summary,
    examples: AgentsTraces.examples,
    requiredScopes: ['cli:agents'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.agents.traces.v1',
    stability: 'beta',
  };
  static override args = { id: Args.string({ required: true, description: 'The agent (deployment id).' }) };
  static override flags = {
    ...scopeFlags,
    from: Flags.string({ description: 'The first day (YYYY-MM-DD); with --to. Default: the last 7 days.' }),
    to: Flags.string({ description: 'The last day (YYYY-MM-DD).' }),
    follow: Flags.boolean({ description: 'Print each new trace once as it happens, until Ctrl-C.' }),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const f = ctx.commandFlags;
    const id = String(ctx.args['id']);
    const range: Record<string, string> =
      typeof f['from'] === 'string' && typeof f['to'] === 'string' ? { from: f['from'], to: f['to'] } : { preset: '7d' };
    const query: Record<string, string> = { ...scopeQuery(f), ...range };
    const api = await agentsApi(ctx);
    if (f['follow'] === true) {
      ctx.io.err(`following the traces of ${id}: new ones print as they happen (Ctrl-C to stop)\n`);
      await followTraces({
        list: () => listTraces(api, id, query),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        // NDJSON under --json: one redacted object per trace.
        emit: (t) => ctx.io.out(ctx.flags.json ? `${JSON.stringify(redactValue(t))}\n` : `${line(t)}\n`),
      });
    }
    return { agentId: id, traces: await listTraces(api, id, query) };
  }

  protected override human(o: Out): HumanView {
    if (o.traces.length === 0) return { text: `No traces of ${o.agentId} in this range.\n` };
    return {
      text: renderTable(
        ['at', 'execution', 'status', 'work'],
        o.traces.map((t) => [t.at, t.executionId, `${t.status ?? '-'}${t.failed ? ' (failed)' : ''}`, t.workTitle ?? '-']),
        terminalTable()
      ),
    };
  }
}
