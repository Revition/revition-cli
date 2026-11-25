import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { Args, Flags } from '@oclif/core';
import {
  atomicWriteFile,
  canPrompt,
  confirmYes,
  defaultCliPaths,
  EXIT,
  RevitionCliError,
  RevitionCommand,
  usageError,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

import { devApi, seg, type Starter, type StarterDetail } from '../api.js';
import { localChecks, PROJECT_MANIFEST_PATH, testsPath, type Problem } from '../checks/local-checks.js';
import { assertWritable, lineDiff, manifestOf, withCapability } from '../generate/manifest-patch.js';
import { assertId, KINDS, renderCapability, renderEvalSuite, renderUiSurface, withTestCase, type Kind } from '../generate/render.js';
import { readProjectDir } from '../project/read-project.js';
import { unsafePath } from '../project/write-starter.js';

interface Catalog {
  readonly extensionPoints: readonly { readonly id: string; readonly title?: string }[];
  readonly starters: readonly Starter[];
}

interface Out {
  readonly kind: Kind | 'list';
  readonly written: readonly string[];
  readonly patched: readonly string[];
  readonly problems: readonly Problem[];
  readonly catalog?: Catalog & { readonly fromCache: boolean };
}

const catalogFile = (): string => join(defaultCliPaths().cacheDir, 'generate-catalog.json');

export default class Generate extends RevitionCommand<Out> {
  static override summary = "Add a piece to the project from the platform's own templates: a capability, a test, an eval suite or the UI surface.";
  static override examples = [
    'revition generate --list',
    'revition generate capability order-sync --point scheduled_job --lang ts --yes',
    'revition generate test order-sync "handles an empty batch" --yes',
    'revition generate eval-suite smoke --capability order-sync --yes',
    'revition generate ui-surface --yes',
  ];
  static meta: CommandMeta = {
    id: 'generate',
    summary: Generate.summary,
    examples: Generate.examples,
    requiredScopes: ['cli:read'],
    // Local files only (nothing on the platform changes): new files are written as `init` writes them, and the edits
    // of existing files (revition.json / tests.json) are confirmed by the command itself after showing the diff.
    // `--list` reads only.
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.generate.v1',
    stability: 'stable',
  };
  static override args = {
    kind: Args.string({ description: `What to add: ${KINDS.join(', ')}.` }),
    name: Args.string({ description: 'The new capability / eval suite name, or the capability a test belongs to.' }),
    caseName: Args.string({ description: 'For `test`: the test case name.' }),
  };
  static override flags = {
    list: Flags.boolean({ description: "List the platform's extension points and their starters." }),
    point: Flags.string({ description: 'For `capability`: the extension point (see --list).' }),
    lang: Flags.option({ options: ['ts', 'python'] as const, default: 'ts', description: 'For `capability`: the language.' })(),
    capability: Flags.string({ description: 'For `eval-suite`: the capability it evaluates.' }),
    dir: Flags.string({ description: 'The project directory (default: the current directory).' }),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    if (ctx.commandFlags['list'] === true) return { kind: 'list', written: [], patched: [], problems: [], catalog: await this.catalog(ctx) };
    const kind = ctx.args['kind'];
    if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) {
      throw usageError('UNKNOWN_KIND', `Unknown kind "${String(kind ?? '')}". Kinds: ${KINDS.join(', ')}.`, 'Run `revition generate --list` for the extension points.');
    }
    const dir = resolve(process.cwd(), typeof ctx.commandFlags['dir'] === 'string' ? ctx.commandFlags['dir'] : '.');
    const current = readProjectDir(dir);
    manifestOf(current); // a project is required (hint: init)
    const plan = await this.plan(ctx, kind as Kind, current);
    assertWritable(current, plan.added, { addsCapability: kind === 'capability' });
    const unsafe = Object.keys(plan.added).filter((f) => unsafePath(dir, f));
    if (unsafe.length > 0) throw new RevitionCliError({ code: 'PATH_REFUSED', message: `Refusing paths outside the project: ${unsafe.join(', ')}.` }, EXIT.usage);
    for (const [file, after] of Object.entries(plan.patched)) ctx.io.err(lineDiff(file, current[file] ?? '', after));
    if (Object.keys(plan.patched).length > 0 && !ctx.flags.yes) {
      if (!canPrompt(ctx.io, { json: ctx.flags.json, noInput: ctx.flags.noInput })) throw usageError('CONFIRMATION_REQUIRED', 'Changing the project files needs confirmation.', 'Re-run with --yes.');
      if (!(await confirmYes(ctx.io, 'Apply these changes?'))) throw new RevitionCliError({ code: 'CANCELLED', message: 'Cancelled.' }, EXIT.cancelled);
    }
    for (const [file, text] of Object.entries({ ...plan.added, ...plan.patched })) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), text, 'utf8');
    }
    // The result goes through the build's local checks at once.
    return { kind: kind as Kind, written: Object.keys(plan.added).sort(), patched: Object.keys(plan.patched).sort(), problems: localChecks(readProjectDir(dir)) };
  }

  private async plan(ctx: CommandContext, kind: Kind, current: Readonly<Record<string, string>>): Promise<{ added: Record<string, string>; patched: Record<string, string> }> {
    const name = typeof ctx.args['name'] === 'string' ? ctx.args['name'] : '';
    if (kind === 'test') {
      const cap = assertId('The capability', name);
      if (!manifestOf(current).capabilities.some((c) => c['id'] === cap)) throw usageError('UNKNOWN_CAPABILITY', `The project has no capability "${cap}".`);
      const caseName = typeof ctx.args['caseName'] === 'string' && ctx.args['caseName'] !== '' ? ctx.args['caseName'] : null;
      if (caseName === null) throw usageError('CASE_NAME_REQUIRED', 'Name the test case: revition generate test <capability> "<case name>".');
      return { added: {}, patched: { [testsPath(cap)]: withTestCase(current[testsPath(cap)], caseName) } };
    }
    if (kind === 'eval-suite') {
      const cap = typeof ctx.commandFlags['capability'] === 'string' ? assertId('The capability', ctx.commandFlags['capability']) : null;
      return { added: { ...renderEvalSuite(assertId('The eval suite', name), cap) }, patched: {} };
    }
    const api = await devApi(ctx);
    if (kind === 'ui-surface') return { added: { ...renderUiSurface(await this.starterFiles(api, 'custom_ui', null)) }, patched: {} };
    const capName = assertId('The capability', name);
    const point = typeof ctx.commandFlags['point'] === 'string' ? ctx.commandFlags['point'] : '';
    const catalog = await this.catalog(ctx);
    if (!catalog.extensionPoints.some((p) => p.id === point)) {
      throw usageError('UNKNOWN_EXTENSION_POINT', `Unknown extension point "${point}". The platform's: ${catalog.extensionPoints.map((p) => p.id).join(', ')}.`);
    }
    const r = renderCapability(await this.starterFiles(api, point, String(ctx.commandFlags['lang'] ?? 'ts')), capName);
    return { added: { ...r.files }, patched: { [PROJECT_MANIFEST_PATH]: withCapability(current[PROJECT_MANIFEST_PATH] ?? '{}', r.entry) } };
  }

  private async starterFiles(api: Awaited<ReturnType<typeof devApi>>, point: string, lang: string | null): Promise<Readonly<Record<string, string>>> {
    const list = (await api.request<{ starters: Starter[] }>({ method: 'GET', path: '/dev/starters', query: { extensionPoint: point } })).body.starters;
    const pick = list.find((s) => lang === null || s.language === lang);
    if (pick === undefined) {
      throw usageError('NO_STARTER', `The platform has no ${lang ?? ''} starter for ${point}.`, `Languages for ${point}: ${[...new Set(list.map((s) => s.language))].join(', ') || 'none'}.`);
    }
    return (await api.request<StarterDetail>({ method: 'GET', path: `/dev/starters/${seg(pick.id)}` })).body.files;
  }

  /** The extension points and starters from the server; offline, the last copy (generating still needs the network). */
  private async catalog(ctx: CommandContext): Promise<Catalog & { fromCache: boolean }> {
    try {
      const api = await devApi(ctx);
      const points = (await api.request<{ extensionPoints: Catalog['extensionPoints'] }>({ method: 'GET', path: '/dev/extension-points' })).body.extensionPoints;
      const starters = (await api.request<{ starters: Starter[] }>({ method: 'GET', path: '/dev/starters' })).body.starters;
      const c: Catalog = { extensionPoints: points, starters };
      await atomicWriteFile(catalogFile(), JSON.stringify(c));
      return { ...c, fromCache: false };
    } catch (e) {
      if (!(e instanceof RevitionCliError) || e.exitCode !== EXIT.network) throw e;
      try {
        return { ...(JSON.parse(readFileSync(catalogFile(), 'utf8')) as Catalog), fromCache: true };
      } catch {
        throw new RevitionCliError({ code: 'OFFLINE_NO_CATALOG', message: 'Offline, and no saved list of extension points yet.', hint: 'Connect once and run `revition generate --list`.' }, EXIT.network);
      }
    }
  }

  protected override human(o: Out): HumanView {
    if (o.catalog !== undefined) {
      const lines = o.catalog.extensionPoints.map((p) => {
        const s = o.catalog?.starters.filter((x) => x.extensionPoint === p.id).map((x) => `${x.id} (${x.language})`) ?? [];
        return `${p.id}: ${s.join(', ') || '-'}`;
      });
      return { text: `${o.catalog.fromCache ? '(offline: the saved list)\n' : ''}${lines.join('\n')}\n` };
    }
    const lines = [...o.written.map((f) => `wrote ${f}`), ...o.patched.map((f) => `updated ${f}`)];
    lines.push(...(o.problems.length === 0 ? ['build (local checks): ok', 'Next: revition build ; revition test'] : o.problems.map((p) => `problem ${p.file}: ${p.message}`)));
    return { text: `${lines.join('\n')}\n` };
  }
}
