import { RevitionCommand, renderTable, terminalTable, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi, seg } from '../../api.js';
import { appOf } from '../submit.js';

import { appFlags } from './list.js';

interface ChannelHead {
  readonly version: string;
  readonly at: string;
  readonly by: string;
}

interface Out {
  readonly appId: string;
  readonly heads: Readonly<Record<string, ChannelHead>>;
  readonly history: readonly (ChannelHead & { readonly channel: string })[];
  readonly listed: readonly string[];
}

export default class VersionsChannels extends RevitionCommand<Out> {
  static override summary = "An app's release channels: the version each offers, and every cut.";
  static override examples = ['revition versions channels --app dapp_123', 'revition versions channels --app dapp_123 --json'];
  static meta: CommandMeta = {
    id: 'versions:channels',
    summary: VersionsChannels.summary,
    examples: VersionsChannels.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.versions.channels.v1',
    stability: 'stable',
  };
  static override flags = appFlags;

  protected async run2(ctx: CommandContext): Promise<Out> {
    const appId = appOf(ctx);
    const api = await devApi(ctx);
    const b = (await api.request<Omit<Out, 'appId'>>({ method: 'GET', path: `/release/apps/${seg(appId)}/channels` })).body;
    return { appId, heads: b.heads ?? {}, history: b.history ?? [], listed: b.listed ?? [] };
  }

  protected override human(o: Out): HumanView {
    const rows = Object.entries(o.heads).map(([channel, h]) => [channel, h.version, h.at.slice(0, 10), h.by]);
    if (rows.length === 0) return { text: `${o.appId} has no channel cut yet (listed: ${o.listed.join(', ') || 'none'}).\n` };
    return {
      text: `${renderTable(['channel', 'version', 'cut', 'by'], rows, terminalTable())}listed: ${o.listed.join(', ') || 'none'}\n`,
    };
  }
}
