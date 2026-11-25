import { Flags } from '@oclif/core';
import { RevitionCommand, renderTable, terminalTable, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi } from '../api.js';

import { parseDuration } from './runs/list.js';

/**
 * T2.4.2 - `revition audit`: the developer's own audit trail (GET /dev/audit, newest first), filtered here (the route
 * takes no filters). Each event shows the client it came from (web / cli / pat / mcp / assist) when the record carries
 * one. Read only.
 */
export type AuditEvent = Readonly<Record<string, unknown>> & { readonly event: string; readonly at: number | string };

const atMs = (e: AuditEvent): number => (typeof e.at === 'number' ? e.at : Date.parse(e.at));

/** `--since` and `--action` (the event name), applied locally. PURE. */
export function filterAudit(
  events: readonly AuditEvent[],
  f: { readonly sinceMs: number | null; readonly action: string | null; readonly nowMs: number }
): AuditEvent[] {
  return events.filter((e) => (f.action === null || e.event === f.action) && (f.sinceMs === null || atMs(e) >= f.nowMs - f.sinceMs));
}

interface Out {
  readonly events: readonly AuditEvent[];
}

export default class Audit extends RevitionCommand<Out> {
  static override summary = 'Your developer audit trail: what was done, when, and from which client.';
  static override examples = ['revition audit', 'revition audit --since 1d --action app_registered', 'revition audit --json'];
  static meta: CommandMeta = {
    id: 'audit',
    summary: Audit.summary,
    examples: Audit.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.audit.v1',
    stability: 'stable',
  };
  static override flags = {
    since: Flags.string({ description: 'Only events newer than this (90s, 30m, 6h, 7d).' }),
    action: Flags.string({ description: 'Only events with this name.' }),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const sinceMs = parseDuration(ctx.commandFlags['since']);
    const action = typeof ctx.commandFlags['action'] === 'string' ? ctx.commandFlags['action'] : null;
    const api = await devApi(ctx);
    const events = (await api.request<{ events: AuditEvent[] }>({ method: 'GET', path: '/dev/audit' })).body.events;
    return { events: filterAudit(events, { sinceMs, action, nowMs: Date.now() }) };
  }

  protected override human(o: Out): HumanView {
    if (o.events.length === 0) return { text: 'No audit events match.\n' };
    return {
      text: renderTable(
        ['at', 'event', 'client', 'details'],
        o.events.map((e) => {
          const { event, at, client, ...rest } = e;
          const details = Object.entries(rest)
            .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
            .join(' ');
          return [new Date(atMs({ event, at })).toISOString(), event, typeof client === 'string' ? client : '-', details];
        }),
        terminalTable()
      ),
    };
  }
}
