import { Flags } from '@oclif/core';
import { RevitionCommand, renderTable, terminalTable, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi, seg } from '../../api.js';
import { appOf, type SubmissionView } from '../submit.js';

/**
 * T2.3.4 - `revition versions`: every version, channel and rollout of an app, READ ONLY. Release changes (promote,
 * rollback, advisories) are human steps in the portal (D9): `versions open` hands off; no release write route is
 * referenced by any CLI module.
 */
export const appFlags = {
  app: Flags.string({ description: 'The app id (default: the linked app).' }),
  dir: Flags.string({ description: 'The project directory (default: the current directory).' }),
};

interface Out {
  readonly appId: string;
  readonly versions: readonly SubmissionView[];
}

export default class VersionsList extends RevitionCommand<Out> {
  static override summary = 'List every submitted version of an app and its status.';
  static override examples = ['revition versions list', 'revition versions list --app dapp_123 --json'];
  static meta: CommandMeta = {
    id: 'versions:list',
    summary: VersionsList.summary,
    examples: VersionsList.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.versions.list.v1',
    stability: 'stable',
  };
  static override flags = appFlags;

  protected async run2(ctx: CommandContext): Promise<Out> {
    const appId = appOf(ctx);
    const api = await devApi(ctx);
    return { appId, versions: (await api.request<{ submissions: SubmissionView[] }>({ method: 'GET', path: `/dev/apps/${seg(appId)}/submissions` })).body.submissions };
  }

  protected override human(o: Out): HumanView {
    if (o.versions.length === 0) return { text: `${o.appId} has no versions yet.\n` };
    return {
      text: renderTable(
        ['version', 'status', 'updated'],
        o.versions.map((v) => [v.version, v.state, v.updatedAt.slice(0, 10)]),
        terminalTable()
      ),
    };
  }
}
