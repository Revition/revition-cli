import { Flags } from '@oclif/core';
import {
  canOpenBrowser,
  openBrowser,
  PRODUCTION_WEB_LINKS,
  RevitionCommand,
  webLinksOf,
  type CommandContext,
  type CommandMeta,
  type HumanView,
  type WebLinks,
} from '@revition/cli-core';

import { assertOpenable } from '../submissions/open.js';
import { appOf } from '../submit.js';

import { appFlags } from './list.js';

export const RELEASE_ACTIONS = ['promote', 'rollback', 'advisory'] as const;

/**
 * The portal's release page: channels, rollouts (promote, advance, halt = rollback) and install advisories live on the
 * Deployment & Distribution page, the same page the server names when it refuses a CLI token on a release write
 * (sentinel/cli-scopes/human-only-routes.ts portalUrlFor: `/release/` -> `/foundry/distribution`).
 */
export function releasePageUrl(links: WebLinks): string {
  return `${links.app}/foundry/distribution`;
}
/** The production page (a profile without `webOrigin`). */
export const RELEASE_PAGE_URL = releasePageUrl(PRODUCTION_WEB_LINKS);

interface Out {
  readonly appId: string;
  readonly action: (typeof RELEASE_ACTIONS)[number] | null;
  readonly url: string;
  readonly opened: boolean;
}

export default class VersionsOpen extends RevitionCommand<Out> {
  static override summary = 'Open the portal release page (promote, rollback, advisories are human steps there).';
  static override examples = ['revition versions open --app dapp_123', 'revition versions open --app dapp_123 --action rollback'];
  static meta: CommandMeta = {
    id: 'versions:open',
    summary: VersionsOpen.summary,
    examples: VersionsOpen.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.versions.open.v1',
    stability: 'stable',
  };
  static override flags = {
    ...appFlags,
    action: Flags.option({ options: RELEASE_ACTIONS, description: 'The release step you will take there.' })(),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const appId = appOf(ctx);
    const a = ctx.commandFlags['action'];
    const action = RELEASE_ACTIONS.find((x) => x === a) ?? null;
    const links = await webLinksOf(ctx);
    const url = assertOpenable(releasePageUrl(links), links);
    const opened = !ctx.flags.json && canOpenBrowser(ctx.env, process.platform) ? await openBrowser(url) : false;
    return { appId, action, url, opened };
  }

  protected override human(o: Out): HumanView {
    const step = o.action === null ? 'release changes' : `the ${o.action}`;
    return { text: `${o.opened ? 'Opened' : 'Open'} ${o.url} to take ${step} for ${o.appId} (a person does it there).\n` };
  }
}
