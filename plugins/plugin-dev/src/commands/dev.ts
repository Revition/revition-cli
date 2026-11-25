import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { Flags } from '@oclif/core';
import {
  canPrompt,
  confirmYes,
  EXIT,
  onCancelCleanup,
  RevitionCliError,
  RevitionCommand,
  usageError,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

import { devApi, seg } from '../api.js';
import { SandboxSession, type Action, type SandboxSessionView } from '../dev/sandbox-session.js';
import { projectUpload } from '../dev/uploader.js';
import { watchProject } from '../dev/watcher.js';
import { readLink } from '../project/project-link.js';
import { unsafePath } from '../project/write-starter.js';

import { renderTests, runProjectTests } from './test.js';

interface Cycle {
  readonly version: number;
  readonly uploaded: number;
  readonly excluded: readonly string[];
  readonly result: unknown;
}

interface Out {
  readonly projectId: string;
  readonly session: SandboxSessionView | null;
  readonly cycles: readonly Cycle[];
  readonly disposed: boolean;
  readonly pulled?: number;
}

function actionOf(f: Readonly<Record<string, unknown>>): Action | null {
  if (typeof f['run'] === 'string') {
    let input: unknown = {};
    if (typeof f['input'] === 'string') {
      try {
        input = JSON.parse(f['input']);
      } catch {
        throw usageError('INPUT_NOT_JSON', '--input is a JSON value.');
      }
    }
    return { kind: 'run', capabilityId: f['run'], input };
  }
  if (typeof f['test'] === 'string') return { kind: 'test', capabilityId: f['test'] };
  if (typeof f['exec'] === 'string') return { kind: 'exec', command: f['exec'] };
  return null;
}

export default class Dev extends RevitionCommand<Out> {
  static override summary = 'The inner loop in the cloud sandbox: save, run, see the result; on every change until Ctrl-C.';
  static override examples = [
    'revition dev --sandbox --run hello --input "{\\"name\\":\\"x\\"}"',
    'revition dev --sandbox --test hello --once --yes',
    'revition dev --sandbox --pull',
  ];
  static meta: CommandMeta = {
    id: 'dev',
    summary: Dev.summary,
    examples: Dev.examples,
    requiredScopes: ['cli:write'],
    // A cloud sandbox is metered to the developer wallet: it is confirmed like every change.
    mutates: true,
    confirm: 'prompt',
    jsonSchemaId: 'revition.dev.v1',
    stability: 'beta',
  };
  static override flags = {
    sandbox: Flags.boolean({ description: "Use the project's cloud sandbox (metered to your developer wallet)." }),
    local: Flags.boolean({ description: "The free local loop: the project's tests on every save, stubbed SDK, no network." }),
    dir: Flags.string({ description: 'The project directory (default: the current directory).' }),
    run: Flags.string({ description: 'After each save: run this capability.' }),
    input: Flags.string({ description: 'With --run: the input, as JSON.' }),
    test: Flags.string({ description: "After each save: run this capability's tests." }),
    exec: Flags.string({ description: 'After each save: run this command in the sandbox.' }),
    once: Flags.boolean({ description: 'One save + action, then stop (scripts and CI).' }),
    keep: Flags.boolean({ description: 'Leave the sandbox running on exit (it still stops after 5 idle minutes).' }),
    pull: Flags.boolean({ description: "Reload: replace the local files with the cloud project's saved version." }),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const f = ctx.commandFlags;
    if (f['local'] === true && f['sandbox'] === true) throw usageError('DEV_MODE_CONFLICT', 'Choose one: --local or --sandbox.');
    if (f['local'] === true) return this.local(ctx, resolve(process.cwd(), typeof f['dir'] === 'string' ? f['dir'] : '.'));
    if (f['sandbox'] !== true) {
      throw usageError('DEV_MODE_REQUIRED', 'Choose the loop: `revition dev --local` (stubbed SDK, free) or `revition dev --sandbox`.');
    }
    const dir = resolve(process.cwd(), typeof f['dir'] === 'string' ? f['dir'] : '.');
    const projectId = readLink(dir)?.projectId ?? null;
    if (projectId === null) {
      throw usageError('NO_CLOUD_PROJECT', 'This directory is not linked to a cloud project.', 'Run `revition link --project <id>` (or `revition init --project new`).');
    }
    const api = await devApi(ctx);
    if (f['pull'] === true) return { projectId, session: null, cycles: [], disposed: false, pulled: await this.pull(ctx, api, projectId, dir) };
    const action = actionOf(f);
    // The upload is checked BEFORE the metered sandbox opens: a refused file costs nothing.
    projectUpload(dir);
    const { session, view } = await SandboxSession.open(api, projectId);
    ctx.io.err(`sandbox ${view.sessionId} (${view.provider}, ${view.tier})${view.resumed ? ' resumed' : ''}; expires ${view.expiresAt}\n`);
    const keep = f['keep'] === true;
    // Ctrl-C deletes the sandbox (unless --keep); the platform's idle stop is the backstop for a killed CLI.
    const release = keep ? () => undefined : onCancelCleanup(() => session.dispose(), { budgetMs: 2000 });
    const cycles: Cycle[] = [];
    const cycle = async (): Promise<Cycle> => {
      const up = projectUpload(dir);
      const version = await session.save(up.files);
      const result = action === null ? null : await session.act(action);
      const c = { version, uploaded: Object.keys(up.files).length, excluded: up.excluded, result };
      cycles.push(c);
      return c;
    };
    if (f['once'] === true) {
      try {
        await cycle();
      } finally {
        release();
        if (!keep) await session.dispose();
      }
      return { projectId, session: view, cycles, disposed: !keep };
    }
    print(ctx, await cycle());
    await new Promise<void>(() => {
      watchProject(dir, () => {
        cycle().then(
          (c) => print(ctx, c),
          (e: unknown) => ctx.io.err(`failed ${e instanceof Error ? e.message : String(e)}\n`)
        );
      });
    });
    return { projectId, session: view, cycles, disposed: false };
  }

  /**
   * T2.1.4 AC1 (REVITION-CLI-PLAN.md:2067 "a local loop re-runs on save"): the local loop reuses `revition test`'s
   * engine (T2.1.3: the stubbed SDK from fixtures.json, no network, no credential, nothing uploaded or billed). The
   * tests run once, then again on every save until Ctrl-C; `--test <capability>` narrows them to one capability.
   */
  private async local(ctx: CommandContext, dir: string): Promise<Out> {
    const f = ctx.commandFlags;
    const only = typeof f['test'] === 'string' ? f['test'] : null;
    const cycles: Cycle[] = [];
    const cycle = async (): Promise<Cycle> => {
      const all = await runProjectTests(dir, null);
      const result = only === null ? all : { ...all, cases: all.cases.filter((c) => c.capability === only) };
      const c = { version: cycles.length + 1, uploaded: 0, excluded: [], result };
      cycles.push(c);
      return c;
    };
    const first = await cycle();
    if (f['once'] === true) return { projectId: 'local', session: null, cycles, disposed: false };
    ctx.io.err(renderTests(first.result as Awaited<ReturnType<typeof runProjectTests>>));
    await new Promise<void>(() => {
      watchProject(dir, () => {
        cycle().then(
          (c) => ctx.io.err(`--- saved (local run ${c.version}) ---\n${renderTests(c.result as Awaited<ReturnType<typeof runProjectTests>>)}`),
          (e: unknown) => ctx.io.err(`failed ${e instanceof Error ? e.message : String(e)}\n`)
        );
      });
    });
    return { projectId: 'local', session: null, cycles, disposed: false };
  }

  /** The reload after a 409: the cloud project's saved files replace the local ones (only after confirmation). */
  private async pull(ctx: CommandContext, api: Awaited<ReturnType<typeof devApi>>, projectId: string, dir: string): Promise<number> {
    const p = (await api.request<{ version: number; files: Record<string, string> }>({ method: 'GET', path: `/dev/projects/${seg(projectId)}` })).body;
    const unsafe = Object.keys(p.files).filter((n) => unsafePath(dir, n));
    if (unsafe.length > 0) throw new RevitionCliError({ code: 'PROJECT_PATH_REFUSED', message: `The project names files outside the directory: ${unsafe.join(', ')}.` }, EXIT.usage);
    if (!ctx.flags.yes) {
      if (!canPrompt(ctx.io, { json: ctx.flags.json, noInput: ctx.flags.noInput })) throw usageError('CONFIRMATION_REQUIRED', 'Replacing local files needs confirmation.', 'Re-run with --yes.');
      if (!(await confirmYes(ctx.io, `Replace local files with the saved version ${p.version}?`))) throw new RevitionCliError({ code: 'CANCELLED', message: 'Cancelled.' }, EXIT.cancelled);
    }
    for (const [name, text] of Object.entries(p.files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text, 'utf8');
    }
    return p.version;
  }

  protected override human(o: Out): HumanView {
    if (o.pulled !== undefined) return { text: `Reloaded version ${o.pulled} of ${o.projectId}.\n` };
    const last = o.cycles.at(-1);
    return { text: `${last === undefined ? '' : summary(last)}${o.disposed ? 'sandbox deleted\n' : ''}` };
  }
}

function summary(c: Cycle): string {
  const r = c.result === null ? '' : `\nresult ${JSON.stringify(c.result)}`;
  return `saved version ${c.version} (${c.uploaded} files${c.excluded.length === 0 ? '' : `, not uploaded: ${c.excluded.join(', ')}`})${r}\n`;
}

function print(ctx: CommandContext, c: Cycle): void {
  ctx.io.err(summary(c));
}
