import { Args, Flags } from '@oclif/core';
import { RevitionCommand, renderTable, terminalTable, type ApiClient, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { agentsApi, seg } from './list.js';

/** One run as GET /deployments/{id}/runs lists it (foundry work/observability-port AgentRunObservation). */
export interface AgentRun {
  readonly runId: string;
  readonly workTitle: string;
  readonly status: string;
  readonly inFlight: boolean;
  readonly startedMs: number;
  readonly endedMs?: number;
  readonly traceRef: string | null;
  readonly costUsd: number | null;
  readonly costNote: string;
}

/** Every page, following the server's cursor to the end (at most `maxPages`). */
export async function allPages<T>(
  fetchPage: (cursor: string | null) => Promise<{ readonly items: readonly T[]; readonly nextCursor: string | null }>,
  maxPages = 200
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(cursor);
    out.push(...page.items);
    if (page.nextCursor === null || page.nextCursor === '') break;
    cursor = page.nextCursor;
  }
  return out;
}

export const scopeFlags = {
  scope: Flags.option({ options: ['all', 'project', 'goal', 'task'] as const, description: 'all (default), or project / goal / task with --scope-id.' })(),
  'scope-id': Flags.string({ description: 'With --scope project / goal / task: its id.' }),
};

export function scopeQuery(f: Readonly<Record<string, unknown>>): Record<string, string> {
  const scope = typeof f['scope'] === 'string' ? f['scope'] : 'all';
  return { scope, ...(typeof f['scope-id'] === 'string' ? { scopeId: f['scope-id'] } : {}) };
}

export async function listAgentRuns(api: ApiClient, id: string, query: Record<string, string | number>): Promise<AgentRun[]> {
  return allPages((cursor) =>
    api
      .request<{ items: AgentRun[]; nextCursor: string | null }>({ method: 'GET', path: `/deployments/${seg(id)}/runs`, query: { ...query, ...(cursor === null ? {} : { cursor }) } })
      .then((r) => r.body)
  );
}

interface Out {
  readonly agentId: string;
  readonly runs: readonly AgentRun[];
}

/** T3.1.5 - `revition agents runs <id>`: the agent's runs for a scope and range, every page. Read only. */
export default class AgentsRuns extends RevitionCommand<Out> {
  static override summary = "An agent's runs (scope and time range), with their billed cost.";
  static override examples = ['revition agents runs dep_123', 'revition agents runs dep_123 --scope goal --scope-id goal_1 --from 2026-11-01T00:00:00Z --json'];
  static meta: CommandMeta = {
    id: 'agents:runs',
    summary: AgentsRuns.summary,
    examples: AgentsRuns.examples,
    requiredScopes: ['cli:agents'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.agents.runs.v1',
    stability: 'beta',
  };
  static override args = { id: Args.string({ required: true, description: 'The agent (deployment id).' }) };
  static override flags = {
    ...scopeFlags,
    from: Flags.string({ description: 'Runs started at or after this time (ISO 8601).' }),
    to: Flags.string({ description: 'Runs started before this time (ISO 8601).' }),
    limit: Flags.integer({ description: 'Page size the server returns (it pages to the end).', min: 1, max: 100 }),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const f = ctx.commandFlags;
    const id = String(ctx.args['id']);
    const query: Record<string, string | number> = {
      ...scopeQuery(f),
      ...(typeof f['from'] === 'string' ? { from: f['from'] } : {}),
      ...(typeof f['to'] === 'string' ? { to: f['to'] } : {}),
      ...(typeof f['limit'] === 'number' ? { limit: f['limit'] } : {}),
    };
    return { agentId: id, runs: await listAgentRuns(await agentsApi(ctx), id, query) };
  }

  protected override human(o: Out): HumanView {
    if (o.runs.length === 0) return { text: `No runs of ${o.agentId} in this scope and range.\n` };
    return {
      text: renderTable(
        ['run', 'work', 'status', 'started', 'cost'],
        o.runs.map((r) => [r.runId, r.workTitle, r.inFlight ? `${r.status} (running)` : r.status, new Date(r.startedMs).toISOString(), r.costUsd === null ? r.costNote : `$${r.costUsd.toFixed(4)}`]),
        terminalTable()
      ),
    };
  }
}
