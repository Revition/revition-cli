import { canOpenBrowser, openBrowser, RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { assertOpenable } from '../submissions/open.js';

import { WALLET_PAGE_URL } from './show.js';

interface Out {
  readonly url: string;
  readonly opened: boolean;
}

/** T2.4.3 - the portal wallet page: top-up is a portal step (the CLI never handles payment data). */
export default class WalletOpen extends RevitionCommand<Out> {
  static override summary = 'Open the Developer Portal wallet (top-up happens there).';
  static override examples = ['revition wallet open'];
  static meta: CommandMeta = {
    id: 'wallet:open',
    summary: WalletOpen.summary,
    examples: WalletOpen.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.wallet.open.v1',
    stability: 'stable',
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const url = assertOpenable(WALLET_PAGE_URL);
    const opened = !ctx.flags.json && canOpenBrowser(ctx.env, process.platform) ? await openBrowser(url) : false;
    return { url, opened };
  }

  protected override human(o: Out): HumanView {
    return { text: `${o.opened ? 'Opened' : 'Open'} ${o.url} to see and top up your developer wallet.\n` };
  }
}
