import {
  EXIT,
  PRODUCTION_WEB_LINKS,
  RevitionCliError,
  RevitionCommand,
  webLinksOf,
  type CommandContext,
  type CommandMeta,
  type HumanView,
  type WebLinks,
} from '@revition/cli-core';

import { devApi } from '../../api.js';

/**
 * T2.4.3 - `revition wallet`: the caller's own developer wallet (GET /dev/wallet: the subject, never a parameter).
 * Amounts come from the server (Mint); only the three wallet fields are kept, so no payment data ever reaches the
 * CLI's output. Top-up stays in the portal.
 */
export interface WalletView {
  readonly credits: number;
  readonly usd: number;
  readonly usedPct: number;
  /** false when no wallet is open yet (credits 0, with the portal top-up link). */
  readonly open: boolean;
  readonly topUpUrl: string;
}

/** The profile's developer portal home, where the wallet panel and its top-up live (devportal dev-dashboard.tsx). */
export function walletPageUrl(links: WebLinks): string {
  return `${links.developer}/`;
}
/** The production page (a profile without `webOrigin`). */
export const WALLET_PAGE_URL = walletPageUrl(PRODUCTION_WEB_LINKS);

/** The server's answer reduced to the wallet's own fields (an allowlist: nothing else is passed on). PURE. */
export function walletOf(body: unknown, topUpUrl: string = WALLET_PAGE_URL): WalletView {
  const b = (body ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return { credits: num(b['credits']), usd: num(b['usd']), usedPct: num(b['usedPct']), open: true, topUpUrl };
}

export default class WalletShow extends RevitionCommand<WalletView> {
  static override summary = 'Your developer wallet balance (build credits), from Mint.';
  static override examples = ['revition wallet show', 'revition wallet show --json'];
  static meta: CommandMeta = {
    id: 'wallet:show',
    summary: WalletShow.summary,
    examples: WalletShow.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.wallet.show.v1',
    stability: 'stable',
  };

  protected async run2(ctx: CommandContext): Promise<WalletView> {
    const api = await devApi(ctx);
    const topUpUrl = walletPageUrl(await webLinksOf(ctx));
    try {
      return walletOf((await api.request({ method: 'GET', path: '/dev/wallet' })).body, topUpUrl);
    } catch (e) {
      // No wallet row yet: zero credits, and where to add some (edge case, plan :2455).
      if (e instanceof RevitionCliError && e.exitCode === EXIT.notFound && e.error.code === 'WALLET_NOT_OPEN') {
        return { credits: 0, usd: 0, usedPct: 0, open: false, topUpUrl };
      }
      throw e;
    }
  }

  protected override human(w: WalletView): HumanView {
    const balance = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(w.usd);
    return {
      text: w.open
        ? `Balance: ${balance} (${w.credits} credits), ${w.usedPct}% used.\nTop up in the Developer Portal: ${w.topUpUrl}\n`
        : `No developer wallet yet: 0 credits.\nTop up in the Developer Portal: ${w.topUpUrl}\n`,
    };
  }
}
