import { resolve } from 'node:path';

import { Args, Flags } from '@oclif/core';
import { RevitionCommand, usageError, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi, seg, type AppRegistration, type DevProjectMeta, type StarterDetail } from '../api.js';
import { assertOwnedApp, assertOwnedProject } from '../project/ownership.js';
import { ensureGitignore, writeLink } from '../project/project-link.js';
import { writeStarter } from '../project/write-starter.js';

interface Out {
  readonly dir: string;
  readonly starter: string;
  readonly files: readonly string[];
  readonly appId: string | null;
  readonly projectId: string | null;
  readonly next: readonly string[];
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);

export default class Init extends RevitionCommand<Out> {
  static override summary = 'Create a project from a platform starter, and optionally link it to an app and a cloud project.';
  static override examples = [
    'revition init my-tool --starter hello-tool',
    'revition init my-tool --starter hello-tool --app dapp_123 --project new --yes',
    'revition init my-tool --starter hello-tool --app new --category tools --description "Looks up orders" --yes',
  ];
  static meta: CommandMeta = {
    id: 'init',
    summary: Init.summary,
    examples: Init.examples,
    requiredScopes: ['cli:read'],
    mutates: true,
    confirm: 'prompt',
    jsonSchemaId: 'revition.init.v1',
    stability: 'stable',
  };
  static override args = { dir: Args.string({ description: 'The new project directory (default: the starter id).' }) };
  static override flags = {
    starter: Flags.string({ required: true, description: 'The starter id (see `revition starters list`).' }),
    name: Flags.string({ description: 'The project name (default: the directory name).' }),
    app: Flags.string({ description: 'Link an app: `new` registers one (needs --category and --description), or an app id you own.' }),
    category: Flags.string({ description: 'With --app new: the app category.' }),
    description: Flags.string({ description: 'With --app new: what the app does.' }),
    project: Flags.string({ description: 'Link a cloud project (sandbox / IDE): `new` creates one from the starter, or a project id you own.' }),
    force: Flags.boolean({ description: 'Write into a non-empty directory (existing files are still never overwritten).' }),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const f = ctx.commandFlags;
    const starterId = String(f['starter']);
    const dir = resolve(process.cwd(), typeof ctx.args['dir'] === 'string' ? ctx.args['dir'] : starterId);
    const name = typeof f['name'] === 'string' && f['name'] !== '' ? f['name'] : dir.split(/[\\/]/).pop() ?? starterId;
    const appFlag = typeof f['app'] === 'string' ? f['app'] : null;
    if (appFlag === 'new' && (typeof f['category'] !== 'string' || typeof f['description'] !== 'string')) {
      throw usageError('APP_MANIFEST_INCOMPLETE', '--app new registers an app and needs --category and --description.');
    }
    const api = await devApi(ctx);
    // 1. The starter's files, from the server; every file name is checked before anything is written.
    const starter = (await api.request<StarterDetail>({ method: 'GET', path: `/dev/starters/${seg(starterId)}` })).body;
    // 2. Ownership is checked BEFORE writing (an app or project you do not own: exit 4, nothing written).
    let appId: string | null = null;
    if (appFlag !== null && appFlag !== 'new') appId = await assertOwnedApp(api, appFlag);
    const projectFlag = typeof f['project'] === 'string' ? f['project'] : null;
    let projectId: string | null = null;
    if (projectFlag !== null && projectFlag !== 'new') projectId = await assertOwnedProject(api, projectFlag);
    const files = writeStarter(dir, starter.files, { force: f['force'] === true });
    if (appFlag === 'new') {
      const manifest = {
        pluginId: slug(name),
        brand: name,
        category: String(f['category']),
        description: String(f['description']),
        version: '0.1.0',
        dataClasses: [],
      };
      appId = (await api.request<AppRegistration>({ method: 'POST', path: '/dev/apps', body: { manifest, scopes: [] } })).body.appId;
    }
    if (projectFlag === 'new') {
      projectId = (await api.request<DevProjectMeta>({ method: 'POST', path: '/dev/projects', body: { name, starterId } })).body.projectId;
    }
    // 3. The local link (ids only) and the ignore lines for the CLI's local caches.
    await writeLink(dir, { appId, projectId });
    await ensureGitignore(dir);
    return { dir, starter: starter.id, files, appId, projectId, next: ['revition test', 'revition dev', 'revition eval'] };
  }

  protected override human(o: Out): HumanView {
    return {
      text: [
        ...o.files.map((f) => `wrote ${f}`),
        `Created ${o.dir} from ${o.starter}.${o.appId === null ? '' : ` App: ${o.appId}.`}${o.projectId === null ? '' : ` Cloud project: ${o.projectId}.`}`,
        `Next: ${o.next.join(' ; ')}`,
        '',
      ].join('\n'),
    };
  }
}
