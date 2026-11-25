import { RevitionCommand, renderTable, terminalTable, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi, seg } from '../../api.js';
import { appOf } from '../submit.js';

import { appFlags } from './list.js';

interface RolloutView {
  readonly channel: string;
  readonly version: string;
  readonly previous: string | null;
  readonly plan: { readonly stages: readonly number[] };
  readonly stageIndex: number;
  readonly status: 'rolling' | 'halted' | 'complete';
}

interface Out {
  readonly appId: string;
  readonly rollouts: readonly RolloutView[];
}

export default class VersionsRollouts extends RevitionCommand<Out> {
  static override summary = "An app's staged rollouts: the version, its current stage and status on each channel.";
  static override examples = ['revition versions rollouts --app dapp_123', 'revition versions rollouts --app dapp_123 --json'];
  static meta: CommandMeta = {
    id: 'versions:rollouts',
    summary: VersionsRollouts.summary,
    examples: VersionsRollouts.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.versions.rollouts.v1',
    stability: 'stable',
  };
  static override flags = appFlags;

  protected async run2(ctx: CommandContext): Promise<Out> {
    const appId = appOf(ctx);
    const api = await devApi(ctx);
    return { appId, rollouts: (await api.request<{ rollouts: RolloutView[] }>({ method: 'GET', path: `/release/apps/${seg(appId)}/rollouts` })).body.rollouts };
  }

  protected override human(o: Out): HumanView {
    if (o.rollouts.length === 0) return { text: `${o.appId} has no rollouts.\n` };
    return {
      text: renderTable(
        ['channel', 'version', 'previous', 'stage', 'status'],
        o.rollouts.map((r) => [r.channel, r.version, r.previous ?? '-', `${r.plan.stages[r.stageIndex] ?? 100}%`, r.status]),
        terminalTable()
      ),
    };
  }
}
