import { resolve } from 'node:path';

import { Flags } from '@oclif/core';
import { RevitionCommand, renderTable, terminalTable, usageError, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi, seg } from '../../api.js';
import { VERDICT, type EvalRun } from '../../eval/report.js';
import { readLink } from '../../project/project-link.js';

interface Out {
  readonly appId: string;
  readonly runs: readonly EvalRun[];
}

export default class EvalList extends RevitionCommand<Out> {
  static override summary = "List an app's evaluation runs, newest first.";
  static override examples = ['revition eval list', 'revition eval list --app dapp_123 --json'];
  static meta: CommandMeta = {
    id: 'eval:list',
    summary: EvalList.summary,
    examples: EvalList.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.eval.list.v1',
    stability: 'beta',
  };
  static override flags = {
    app: Flags.string({ description: 'The app id (default: the linked app).' }),
    dir: Flags.string({ description: 'The project directory (default: the current directory).' }),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const f = ctx.commandFlags;
    const dir = resolve(process.cwd(), typeof f['dir'] === 'string' ? f['dir'] : '.');
    const appId = typeof f['app'] === 'string' ? f['app'] : (readLink(dir)?.appId ?? null);
    if (appId === null) throw usageError('APP_REQUIRED', 'No app: this directory is not linked to one.', 'Pass --app <id> or run `revition link`.');
    const api = await devApi(ctx);
    const runs = (await api.request<{ runs: EvalRun[] }>({ method: 'GET', path: `/dev/apps/${seg(appId)}/evals` })).body.runs;
    return { appId, runs };
  }

  protected override human(o: Out): HumanView {
    if (o.runs.length === 0) return { text: `No evaluation runs for ${o.appId} yet. Run \`revition eval run\`.\n` };
    return {
      text: renderTable(
        ['run', 'suite', 'verdict', 'pass rate', 'billed', 'at'],
        o.runs.map((r) => [
          r.runId,
          r.suiteId,
          VERDICT[r.report.verdict],
          `${(r.passRate * 100).toFixed(0)}%`,
          r.billedCredits === undefined ? '-' : `${r.billedCredits} credits`,
          r.at,
        ]),
        terminalTable()
      ),
    };
  }
}
