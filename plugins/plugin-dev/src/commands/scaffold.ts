import { resolve } from 'node:path';

import { Args } from '@oclif/core';
import { RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi, seg, type StarterDetail } from '../api.js';
import { writeStarter } from '../project/write-starter.js';

interface Out {
  readonly dir: string;
  readonly title: string;
  readonly files: readonly string[];
}

/**
 * T2.1.1 - the legacy `revition scaffold <starter> [dir]` (T0.1.3 parity): the starter's files, byte-equal to the
 * legacy CLI's output, into a new directory (default: the starter id). `init` is the full flow (link + ignore lines).
 */
export default class Scaffold extends RevitionCommand<Out> {
  static override summary = 'Write a starter project into a new directory (the legacy form of `revition init`).';
  static override examples = ['revition scaffold hello-tool', 'revition scaffold hello-tool my-tool'];
  static meta: CommandMeta = {
    id: 'scaffold',
    summary: Scaffold.summary,
    examples: Scaffold.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.scaffold.v1',
    stability: 'stable',
  };
  static override args = {
    starter: Args.string({ required: true, description: 'The starter id.' }),
    dir: Args.string({ description: 'The new directory (default: the starter id).' }),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const starterId = String(ctx.args['starter']);
    const dir = resolve(process.cwd(), typeof ctx.args['dir'] === 'string' ? ctx.args['dir'] : starterId);
    const api = await devApi(ctx);
    const s = (await api.request<StarterDetail>({ method: 'GET', path: `/dev/starters/${seg(starterId)}` })).body;
    // Legacy semantics: refuse only when a target file exists (a non-empty directory is fine).
    const files = writeStarter(dir, s.files, { force: true });
    return { dir, title: s.title, files };
  }

  protected override human(o: Out): HumanView {
    return { text: `${o.files.map((f) => `wrote ${f}`).join('\n')}\n${o.title} is in ${o.dir}. Next: revition build, then revition test.\n` };
  }
}
