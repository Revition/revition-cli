import { Flags } from '@oclif/core';
import { RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi } from '../api.js';

/**
 * T2.4.4 - `revition changelog`: the platform SDK's changelog (GET /dev/docs/changelog: what each version added,
 * changed, deprecated with its removal window, removed), or `--cli`: this CLI's version and its release notes.
 */
interface ChangelogEntry {
  readonly version: string;
  readonly date: string;
  readonly summary: string;
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly deprecated: readonly { readonly call: string; readonly removeIn: string; readonly windowDays: number }[];
  readonly removed: readonly string[];
}

export const CLI_RELEASES_URL = 'https://github.com/Revition/revition-cli/releases';

type Out =
  | { readonly of: 'platform'; readonly entries: readonly ChangelogEntry[] }
  | { readonly of: 'cli'; readonly version: string; readonly releasesUrl: string };

/** One SDK version's lines. PURE. */
export function entryLines(e: ChangelogEntry): string[] {
  return [
    `${e.version} (${e.date}): ${e.summary}`,
    ...(e.added.length === 0 ? [] : [`  added: ${e.added.join(', ')}`]),
    ...(e.changed.length === 0 ? [] : [`  changed: ${e.changed.join(', ')}`]),
    ...e.deprecated.map((d) => `  deprecated: ${d.call} (removed in ${d.removeIn}, at least ${d.windowDays} days)`),
    ...(e.removed.length === 0 ? [] : [`  removed: ${e.removed.join(', ')}`]),
  ];
}

export default class Changelog extends RevitionCommand<Out> {
  static override summary = "The platform SDK's changelog, or this CLI's release notes (--cli).";
  static override examples = ['revition changelog', 'revition changelog --cli', 'revition changelog --json'];
  static meta: CommandMeta = {
    id: 'changelog',
    summary: Changelog.summary,
    examples: Changelog.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.changelog.v1',
    stability: 'stable',
  };
  static override flags = {
    platform: Flags.boolean({ description: "The platform SDK's changelog (the default).", exclusive: ['cli'] }),
    cli: Flags.boolean({ description: "This CLI's version and its release notes.", exclusive: ['platform'] }),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    if (ctx.commandFlags['cli'] === true) return { of: 'cli', version: ctx.cliVersion, releasesUrl: CLI_RELEASES_URL };
    const api = await devApi(ctx);
    return { of: 'platform', entries: (await api.request<{ entries: ChangelogEntry[] }>({ method: 'GET', path: '/dev/docs/changelog' })).body.entries };
  }

  protected override human(o: Out): HumanView {
    if (o.of === 'cli') return { text: `revition ${o.version}\nRelease notes: ${o.releasesUrl}\n` };
    return { text: `${o.entries.flatMap(entryLines).join('\n')}\n` };
  }
}
