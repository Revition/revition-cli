import { Flags } from '@oclif/core';
import { RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi, seg } from '../api.js';

import { appOf } from './submit.js';

/**
 * T2.4.2 - `revition analytics`: an app's publisher analytics as the portal shows them (devportal analytics-panel.tsx):
 * the same labels and number formats. A metric nobody records prints "not recorded" with the reason, NEVER a zero.
 * Read only; every number comes from the server.
 */
export const METRICS = ['installs', 'active', 'revenueUsd', 'rating', 'errorRate', 'upliftTrend'] as const;
type Metric = (typeof METRICS)[number];

export interface PublisherAnalytics {
  readonly appId: string;
  readonly published: boolean;
  readonly period: { readonly days: number; readonly startMs: number; readonly endMs: number };
  readonly stats: {
    readonly installs: number;
    readonly active: number;
    readonly revenueUsd: number;
    readonly rating: number;
    readonly errorRate: number;
    readonly upliftTrend: readonly number[];
  };
  readonly sources: Readonly<Record<Metric, { readonly state: 'recorded' } | { readonly state: 'not_recorded'; readonly why: string }>>;
  readonly payouts: { readonly grossUsd: number; readonly feeUsd: number; readonly netUsd: number; readonly pendingUsd: number } | null;
  readonly upliftVersions: readonly string[];
}

const LABELS: Readonly<Record<Metric, string>> = {
  installs: 'Installs',
  active: 'Active installs',
  revenueUsd: 'Revenue (all your apps)',
  rating: 'Rating',
  errorRate: 'Error rate',
  upliftTrend: 'Eval uplift (task success, per published version)',
};

const usd = (n: number): string => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const pct = (d: number): string => `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}%`;

/** A recorded metric as the portal's tile reads it (analytics-panel.tsx metricText). PURE. */
export function metricText(m: Metric, a: PublisherAnalytics): string {
  const s = a.stats;
  switch (m) {
    case 'revenueUsd':
      return usd(s.revenueUsd);
    case 'rating':
      return s.rating === 0 ? '0' : `${s.rating.toFixed(1)} of 5`;
    case 'errorRate':
      return `${(s.errorRate * 100).toFixed(1)}%`;
    case 'upliftTrend':
      return s.upliftTrend.map((d, i) => `${a.upliftVersions[i] ?? ''} ${pct(d)}`.trim()).join(', ') || '-';
    default:
      return String(s[m]);
  }
}

/** Each metric: its value, or "not recorded: <why>" (never a zero). PURE. */
export function analyticsLines(a: PublisherAnalytics): string[] {
  const head = `${a.appId}: last ${a.period.days} days`;
  if (!a.published) {
    return [head, "Nothing to show yet: an app's installs, revenue, rating, errors and uplift appear once a certified version is published."];
  }
  const rows = METRICS.map((m) => {
    const src = a.sources[m];
    return `  ${LABELS[m]}: ${src.state === 'recorded' ? metricText(m, a) : `not recorded: ${src.why}`}`;
  });
  const p = a.payouts;
  const payouts = p === null ? [] : [`  Payouts: gross ${usd(p.grossUsd)}, fee ${usd(p.feeUsd)}, net ${usd(p.netUsd)}, pending ${usd(p.pendingUsd)}`];
  return [head, ...rows, ...payouts];
}

export default class Analytics extends RevitionCommand<PublisherAnalytics> {
  static override summary = "An app's publisher analytics (installs, revenue, rating, errors, eval uplift).";
  static override examples = ['revition analytics --app dapp_123', 'revition analytics --days 7 --json'];
  static meta: CommandMeta = {
    id: 'analytics',
    summary: Analytics.summary,
    examples: Analytics.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.analytics.v1',
    stability: 'stable',
  };
  static override flags = {
    app: Flags.string({ description: 'The app id (default: the linked app).' }),
    dir: Flags.string({ description: 'The project directory (default: the current directory).' }),
    days: Flags.option({ options: ['7', '30', '90'] as const, description: 'The period in days (default 30).' })(),
  };

  protected async run2(ctx: CommandContext): Promise<PublisherAnalytics> {
    const appId = appOf(ctx);
    const days = typeof ctx.commandFlags['days'] === 'string' ? ctx.commandFlags['days'] : '30';
    const api = await devApi(ctx);
    return (await api.request<PublisherAnalytics>({ method: 'GET', path: `/dev/apps/${seg(appId)}/analytics`, query: { days } })).body;
  }

  protected override human(a: PublisherAnalytics): HumanView {
    return { text: `${analyticsLines(a).join('\n')}\n` };
  }
}
