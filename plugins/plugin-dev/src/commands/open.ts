import { resolve } from 'node:path';

import { Args, Flags } from '@oclif/core';
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

import { readLink } from '../project/project-link.js';

import { assertOpenable } from './submissions/open.js';

/**
 * T2.4.4 - `revition open [app|project|sessions|wallet|docs]`: the Developer Portal page for the thing named; only
 * Revition pages over https are opened (`assertOpenable`), and with no browser the URL is printed.
 */
export const OPEN_TARGETS = ['app', 'project', 'sessions', 'wallet', 'docs'] as const;
type Target = (typeof OPEN_TARGETS)[number];

/** The portal page of each target, on the profile's developer portal (plan amendment 2026-11-27, #537). PURE. */
export function targetUrl(target: Target, projectId: string | null, links: WebLinks = PRODUCTION_WEB_LINKS): string {
  const portal = links.developer;
  switch (target) {
    case 'app':
      return `${portal}/apps`;
    case 'project':
      return projectId === null ? `${portal}/ide` : `${portal}/ide/${encodeURIComponent(projectId)}`;
    case 'sessions':
      return `${portal}/cli-sessions`;
    case 'wallet':
      return `${portal}/`;
    case 'docs':
      return `${portal}/docs`;
  }
}

interface Out {
  readonly target: Target;
  readonly url: string;
  readonly opened: boolean;
}

export default class Open extends RevitionCommand<Out> {
  static override summary = 'Open a Developer Portal page (prints the URL when no browser is available).';
  static override examples = ['revition open', 'revition open project', 'revition open sessions'];
  static meta: CommandMeta = {
    id: 'open',
    summary: Open.summary,
    examples: Open.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.open.v1',
    stability: 'stable',
  };
  static override args = { target: Args.string({ options: [...OPEN_TARGETS], description: 'What to open (default: app).' }) };
  static override flags = { dir: Flags.string({ description: 'The project directory (default: the current directory).' }) };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const target = (typeof ctx.args['target'] === 'string' ? ctx.args['target'] : 'app') as Target;
    const dir = resolve(process.cwd(), typeof ctx.commandFlags['dir'] === 'string' ? ctx.commandFlags['dir'] : '.');
    const links = await webLinksOf(ctx);
    const url = assertOpenable(targetUrl(target, readLink(dir)?.projectId ?? null, links), links);
    const opened = !ctx.flags.json && canOpenBrowser(ctx.env, process.platform) ? await openBrowser(url) : false;
    return { target, url, opened };
  }

  protected override human(o: Out): HumanView {
    return { text: `${o.opened ? 'Opened' : 'Open'} ${o.url}\n` };
  }
}
