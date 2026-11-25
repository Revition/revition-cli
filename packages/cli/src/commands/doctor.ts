import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  ApiClient,
  defaultCliPaths,
  dispatcherFor,
  loadProjectFile,
  loadUserConfig,
  resolveSettings,
  RevitionCliError,
  RevitionCommand,
  runDoctor,
  status,
  type CommandContext,
  type CommandMeta,
  type DoctorDeps,
  type DoctorReport,
  type HumanView,
} from '@revition/cli-core';
import { request } from 'undici';

const run = promisify(execFile);
const PROBE_TIMEOUT_MS = 5_000;

export default class Doctor extends RevitionCommand<DoctorReport> {
  static override summary = 'Diagnose this machine: version, Node, config, credential store, host, TLS, proxy, clock.';
  static override examples = ['revition doctor', 'revition doctor --json'];
  static meta: CommandMeta = {
    id: 'doctor',
    summary: Doctor.summary,
    examples: Doctor.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.doctor.v1',
    stability: 'stable',
  };

  protected async run2(ctx: CommandContext): Promise<DoctorReport> {
    return runDoctor(await realDoctorDeps(ctx, this.config.version));
  }

  protected override human(report: DoctorReport): HumanView {
    const lines = report.checks.map((c) => `${status(c.status, false).padEnd(6)} ${c.id.padEnd(17)} ${c.message}${c.hint === null ? '' : `\n${' '.repeat(25)}${c.hint}`}`);
    return { text: `${lines.join('\n')}\n${report.summary.ok} ok, ${report.summary.warn} warn, ${report.summary.fail} failed\n` };
  }
}

async function realDoctorDeps(ctx: CommandContext, cliVersion: string): Promise<DoctorDeps> {
  const paths = defaultCliPaths();
  const loaded = await loadUserConfig(paths.configFile).then(
    (r) => ({ ok: true as const, config: r.config, detail: `${paths.configFile} is readable.` }),
    (e: unknown) => ({ ok: false as const, config: null, detail: e instanceof RevitionCliError ? e.error.message : String(e) })
  );
  const project = await loadProjectFile(process.cwd()).catch(() => null);
  const settings = loaded.config === null ? null : resolveSettings({ flags: { profile: ctx.flags.profile }, env: ctx.env, project: project?.project ?? null, user: loaded.config });
  const host = settings?.host.value ?? 'api.revition.com';
  return {
    cliVersion,
    channel: 'stable',
    latestVersion: async () => {
      const url = new URL('https://registry.npmjs.org/@revition%2fcli');
      const res = await request(url, { dispatcher: dispatcherFor(url, ctx.env), headersTimeout: PROBE_TIMEOUT_MS, bodyTimeout: PROBE_TIMEOUT_MS });
      const body = (await res.body.json()) as { 'dist-tags'?: Record<string, string> };
      return body['dist-tags']?.['latest'] ?? null;
    },
    nodeVersion: process.version,
    platform: platform(),
    arch: arch(),
    host,
    env: ctx.env,
    configReadable: async () => ({ ok: loaded.ok, detail: loaded.detail }),
    credentialBackend: () => credentialBackend(ctx.env),
    tokenState: async () => {
      // The credential store arrives with T1.3.1; until then only REVITION_TOKEN (CI) can be signed in.
      const token = ctx.env['REVITION_TOKEN'];
      if (token === undefined || token === '') return 'not_logged_in';
      const client = new ApiClient({ host, token: async () => token, cliVersion, retries: 0, timeoutMs: PROBE_TIMEOUT_MS }, { env: ctx.env });
      try {
        await client.request({ method: 'GET', path: '/dev/me' });
        return 'valid';
      } catch (e) {
        return e instanceof RevitionCliError && e.exitCode === 3 ? 'invalid' : 'unreachable';
      }
    },
    probeHost: async () => {
      const url = new URL(`https://${host}/`);
      try {
        const res = await request(url, { method: 'HEAD', dispatcher: dispatcherFor(url, ctx.env), headersTimeout: PROBE_TIMEOUT_MS });
        await res.body.dump();
        const date = res.headers['date'];
        return { reachable: true, tls: 'ok', serverDate: typeof date === 'string' ? date : null, error: null };
      } catch (e) {
        const code = String((e as { code?: string }).code ?? e);
        const tls = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code);
        return { reachable: tls, tls: tls ? 'failed' : 'unknown', serverDate: null, error: code };
      }
    },
    telemetry: async () => settings?.telemetry.value ?? 'unset',
    flagCacheAgeMs: async () => {
      const s = await stat(join(paths.cacheDir, `flags-${settings?.profile.value ?? 'default'}.json`)).catch(() => null);
      return s === null ? null : Date.now() - s.mtimeMs;
    },
    now: Date.now,
  };
}

/** Which credential store this machine offers, without touching any secret (the store itself is T1.3.1). */
async function credentialBackend(env: Readonly<Record<string, string | undefined>>): Promise<'keychain' | 'encrypted-file' | 'none'> {
  const p = platform();
  if (p === 'win32') return 'keychain';
  if (p === 'darwin') {
    return run('/usr/bin/security', ['list-keychains']).then(() => 'keychain' as const, () => 'encrypted-file' as const);
  }
  if ((env['DBUS_SESSION_BUS_ADDRESS'] ?? '') === '') return 'encrypted-file';
  return run('secret-tool', ['--version']).then(() => 'keychain' as const, () => 'encrypted-file' as const);
}
