import { resolve } from 'node:path';

import { Flags } from '@oclif/core';
import { EXIT, RevitionCliError, RevitionCommand, webLinksOf, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi } from '../api.js';
import { localChecks, type CheckId, type Problem } from '../checks/local-checks.js';
import { readProjectDir } from '../project/read-project.js';

export const BUILD_SCHEMA_ID = 'revition.build.v1';

/** The server's answer (POST /dev/authoring/check, the platform's `checkProject`). */
export interface ServerCheck {
  readonly ok: boolean;
  readonly problems: readonly { readonly file: string; readonly message: string }[];
  readonly warnings: readonly { readonly file: string; readonly message: string }[];
  readonly buildLogs: Readonly<Record<string, readonly string[]>>;
}

interface CheckRow {
  readonly id: CheckId | 'server';
  readonly status: 'ok' | 'failed' | 'skipped';
}

export interface BuildOut {
  readonly schemaId: typeof BUILD_SCHEMA_ID;
  readonly dir: string;
  readonly ok: boolean;
  readonly mode: 'local+server' | 'local-only';
  readonly checks: readonly CheckRow[];
  readonly problems: readonly Problem[];
  readonly warnings: readonly Problem[];
  readonly buildLogs: Readonly<Record<string, readonly string[]>>;
}

const LOCAL_CHECKS: readonly CheckId[] = ['size', 'manifest', 'layout', 'tests'];

export default class Build extends RevitionCommand<BuildOut> {
  static override summary = "Check the project: the platform's layout rules locally, then the platform's own checks.";
  static override examples = ['revition build', 'revition build --dir ./my-tool --json', 'revition build --strict'];
  static meta: CommandMeta = {
    id: 'build',
    summary: Build.summary,
    examples: Build.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: BUILD_SCHEMA_ID,
    stability: 'stable',
  };
  static override flags = {
    dir: Flags.string({ description: 'The project directory (default: the current directory).' }),
    strict: Flags.boolean({ description: 'Fail on warnings too.' }),
  };

  protected async run2(ctx: CommandContext): Promise<BuildOut> {
    const dir = resolve(process.cwd(), typeof ctx.commandFlags['dir'] === 'string' ? ctx.commandFlags['dir'] : '.');
    const files = readProjectDir(dir);
    // 1. Local: an oversized or broken project is refused here, before anything is sent.
    const local = localChecks(files);
    const failedLocal = new Set(local.map((p) => p.check));
    const checks: CheckRow[] = LOCAL_CHECKS.map((id) => ({ id, status: failedLocal.has(id) ? 'failed' : 'ok' }));
    let server: ServerCheck | null = null;
    let mode: BuildOut['mode'] = 'local+server';
    if (local.length === 0) {
      // 2. The server's authoritative check always runs when online (credit-gated, metered at 0 credits).
      try {
        const api = await devApi(ctx);
        server = (await api.request<ServerCheck>({ method: 'POST', path: '/dev/authoring/check', body: { files } })).body;
      } catch (e) {
        if (e instanceof RevitionCliError && e.exitCode === EXIT.network) {
          mode = 'local-only';
          ctx.warn('Local checks only: the platform could not be reached, so its own checks did not run.');
        } else if (e instanceof RevitionCliError && e.exitCode === EXIT.payment) {
          throw new RevitionCliError(
            { ...e.error, hint: `The build check is billed to your developer wallet. Add funds in the Developer Portal: ${(await webLinksOf(ctx)).developer}` },
            EXIT.payment
          );
        } else {
          throw e;
        }
      }
    }
    checks.push({ id: 'server', status: server === null ? 'skipped' : server.ok ? 'ok' : 'failed' });
    const problems: Problem[] = [...local, ...(server?.problems ?? []).map((p) => ({ check: 'server' as const, ...p, severity: 'error' as const }))];
    const warnings: Problem[] = (server?.warnings ?? []).map((w) => ({ check: 'server' as const, ...w, severity: 'warning' as const }));
    const ok = problems.length === 0 && (ctx.commandFlags['strict'] !== true || warnings.length === 0);
    if (!ok) ctx.setExitCode?.(EXIT.conflict);
    return { schemaId: BUILD_SCHEMA_ID, dir, ok, mode, checks, problems, warnings, buildLogs: server?.buildLogs ?? {} };
  }

  protected override human(o: BuildOut): HumanView {
    const lines: string[] = [];
    for (const [id, log] of Object.entries(o.buildLogs)) lines.push(`${id}:`, ...log.map((l) => `  ${l}`));
    for (const w of o.warnings) lines.push(`warning ${w.file}: ${w.message}`);
    for (const p of o.problems) lines.push(`problem ${p.file}: ${p.message}`);
    if (o.mode === 'local-only') lines.push('local checks only');
    lines.push(o.ok ? 'ok: the project passes the build’s checks' : 'the project has problems');
    return { text: `${lines.join('\n')}\n` };
  }
}
