import { Flags } from '@oclif/core';
import {
  canPrompt,
  confirmYes,
  EXIT,
  RevitionCliError,
  RevitionCommand,
  usageError,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

import { devApi } from '../api.js';
import { assertOwnedApp, assertOwnedProject } from '../project/ownership.js';
import { readLink, writeLink } from '../project/project-link.js';

interface Out {
  readonly file: string;
  readonly appId: string | null;
  readonly projectId: string | null;
  readonly changed: boolean;
}

export default class Link extends RevitionCommand<Out> {
  static override summary = 'Link this directory to an app and / or a cloud project you own (local only; nothing changes on the server).';
  static override examples = ['revition link --app dapp_123', 'revition link --project dproj_abc --yes'];
  static meta: CommandMeta = {
    id: 'link',
    summary: Link.summary,
    examples: Link.examples,
    requiredScopes: ['cli:read'],
    // LOCAL: it writes .revition/project.json after the server confirms ownership; no server write.
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.link.v1',
    stability: 'stable',
  };
  static override flags = {
    app: Flags.string({ description: 'An app id you own (see `revition apps list`).' }),
    project: Flags.string({ description: 'A cloud project id you own.' }),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const f = ctx.commandFlags;
    const wantApp = typeof f['app'] === 'string' && f['app'] !== '' ? f['app'] : null;
    const wantProject = typeof f['project'] === 'string' && f['project'] !== '' ? f['project'] : null;
    if (wantApp === null && wantProject === null) throw usageError('NOTHING_TO_LINK', 'Pass --app and / or --project.');
    const dir = process.cwd();
    const api = await devApi(ctx);
    // Ownership first: a foreign app or project is exit 4 and nothing is written.
    const appId = wantApp === null ? null : await assertOwnedApp(api, wantApp);
    const projectId = wantProject === null ? null : await assertOwnedProject(api, wantProject);
    const current = readLink(dir);
    const next = { appId: appId ?? current?.appId ?? null, projectId: projectId ?? current?.projectId ?? null };
    const changed = current === null || current.appId !== next.appId || current.projectId !== next.projectId;
    if (current !== null && changed && !ctx.flags.yes) {
      // An existing link is updated only after confirmation.
      if (!canPrompt(ctx.io, { json: ctx.flags.json, noInput: ctx.flags.noInput })) {
        throw usageError('CONFIRMATION_REQUIRED', 'This directory is already linked; changing the link needs confirmation.', 'Re-run with --yes.');
      }
      if (!(await confirmYes(ctx.io, `Replace the link (app ${current.appId ?? '-'}, project ${current.projectId ?? '-'})?`))) {
        throw new RevitionCliError({ code: 'CANCELLED', message: 'Cancelled.' }, EXIT.cancelled);
      }
    }
    const file = changed ? await writeLink(dir, next) : `${dir}/.revition/project.json`;
    return { file, ...next, changed };
  }

  protected override human(o: Out): HumanView {
    return { text: `${o.changed ? 'Linked' : 'Already linked'}: app ${o.appId ?? '-'}, project ${o.projectId ?? '-'} (${o.file}).\n` };
  }
}
