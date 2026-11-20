import { Flags } from '@oclif/core';
import { RevitionCommand, renderTable, terminalTable, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi, seg } from '../../api.js';
import { appOf, type SubmissionView } from '../submit.js';

interface Out {
  readonly appId: string;
  readonly submissions: readonly SubmissionView[];
}

export default class SubmissionsList extends RevitionCommand<Out> {
  static override summary = "List an app's submitted versions and where each stands.";
  static override examples = ['revition submissions list', 'revition submissions list --app dapp_123 --json'];
  static meta: CommandMeta = {
    id: 'submissions:list',
    summary: SubmissionsList.summary,
    examples: SubmissionsList.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.submissions.list.v1',
    stability: 'stable',
  };
  static override flags = {
    app: Flags.string({ description: 'The app id (default: the linked app).' }),
    dir: Flags.string({ description: 'The project directory (default: the current directory).' }),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const appId = appOf(ctx);
    const api = await devApi(ctx);
    return { appId, submissions: (await api.request<{ submissions: SubmissionView[] }>({ method: 'GET', path: `/dev/apps/${seg(appId)}/submissions` })).body.submissions };
  }

  protected override human(o: Out): HumanView {
    if (o.submissions.length === 0) return { text: `No submissions for ${o.appId} yet. Run \`revition submit --version <x.y.z>\`.\n` };
    return {
      text: renderTable(
        ['version', 'state', 'submitted', 'updated'],
        o.submissions.map((s) => [s.version, s.state === 'certified' ? 'certified (ready to publish)' : s.state, s.createdAt.slice(0, 10), s.updatedAt.slice(0, 10)]),
        terminalTable()
      ),
    };
  }
}
