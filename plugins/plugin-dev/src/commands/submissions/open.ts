import { Args, Flags } from '@oclif/core';
import {
  canOpenBrowser,
  isWebLink,
  openBrowser,
  PRODUCTION_WEB_LINKS,
  RevitionCliError,
  RevitionCommand,
  EXIT,
  webLinksOf,
  type CommandContext,
  type CommandMeta,
  type HumanView,
  type WebLinks,
} from '@revition/cli-core';

import { devApi, seg } from '../../api.js';
import { appOf, publishPageUrl, type SubmissionView } from '../submit.js';

/** The production hand-off hosts (a profile without `webOrigin`): the Revition web app and the developer portal. */
export const OPEN_ALLOWLIST: readonly string[] = PRODUCTION_WEB_LINKS.hosts;

/** Only an https page on the profile's own web hosts is opened (plan amendment 2026-11-27, #537). */
export function assertOpenable(url: string, links: WebLinks = PRODUCTION_WEB_LINKS): string {
  if (!isWebLink(url, links)) {
    throw new RevitionCliError({ code: 'URL_NOT_ALLOWED', message: `Refusing to open ${url}: not a Revition page.` }, EXIT.usage);
  }
  return new URL(url).toString();
}

interface Out {
  readonly appId: string;
  readonly version: string;
  readonly state: string;
  readonly url: string;
  readonly opened: boolean;
}

/** T2.3.3 - the human publish step: open the portal page where a person publishes. The CLI never publishes. */
export default class SubmissionsOpen extends RevitionCommand<Out> {
  static override summary = 'Open the portal page where a person publishes a certified version (the CLI never publishes).';
  static override examples = ['revition submissions open 1.2.0', 'revition submissions open 1.2.0 --app dapp_123'];
  static meta: CommandMeta = {
    id: 'submissions:open',
    summary: SubmissionsOpen.summary,
    examples: SubmissionsOpen.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.submissions.open.v1',
    stability: 'stable',
  };
  static override args = { version: Args.string({ required: true, description: 'The submitted version (x.y.z).' }) };
  static override flags = {
    app: Flags.string({ description: 'The app id (default: the linked app).' }),
    dir: Flags.string({ description: 'The project directory (default: the current directory).' }),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const appId = appOf(ctx);
    const version = String(ctx.args['version']);
    const api = await devApi(ctx);
    const s = (await api.request<SubmissionView>({ method: 'GET', path: `/dev/apps/${seg(appId)}/submissions/${seg(version)}` })).body;
    if (s.state !== 'certified') ctx.warn(`${version} is ${s.state}: only a certified version can be published.`);
    const links = await webLinksOf(ctx);
    const url = assertOpenable(publishPageUrl(links), links);
    const opened = !ctx.flags.json && canOpenBrowser(ctx.env, process.platform) ? await openBrowser(url) : false;
    return { appId, version, state: s.state, url, opened };
  }

  protected override human(o: Out): HumanView {
    return { text: `${o.opened ? 'Opened' : 'Open'} ${o.url} to publish ${o.appId} ${o.version} (a person publishes it there).\n` };
  }
}
