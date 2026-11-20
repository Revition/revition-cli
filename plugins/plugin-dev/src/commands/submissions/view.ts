import { Args, Flags } from '@oclif/core';
import { RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi, seg } from '../../api.js';
import { appOf, submissionLines, type SubmissionView } from '../submit.js';

export default class SubmissionsView extends RevitionCommand<SubmissionView> {
  static override summary = 'Show one submitted version: every check result and reason, and the review decision.';
  static override examples = ['revition submissions view 1.2.0', 'revition submissions view 1.2.0 --app dapp_123 --json'];
  static meta: CommandMeta = {
    id: 'submissions:view',
    summary: SubmissionsView.summary,
    examples: SubmissionsView.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.submissions.view.v1',
    stability: 'stable',
  };
  static override args = { version: Args.string({ required: true, description: 'The submitted version (x.y.z).' }) };
  static override flags = {
    app: Flags.string({ description: 'The app id (default: the linked app).' }),
    dir: Flags.string({ description: 'The project directory (default: the current directory).' }),
  };

  protected async run2(ctx: CommandContext): Promise<SubmissionView> {
    const appId = appOf(ctx);
    const api = await devApi(ctx);
    return (await api.request<SubmissionView>({ method: 'GET', path: `/dev/apps/${seg(appId)}/submissions/${seg(String(ctx.args['version']))}` })).body;
  }

  protected override human(s: SubmissionView): HumanView {
    return { text: `${submissionLines(s).join('\n')}\n` };
  }
}
