import { RevitionCliError } from '../errors/cli-error.js';
import { EXIT } from '../output/exit-codes.js';

import { installedManifest, listInstalled, manifestOf, removeInstalled, unpackTarball, writeInstalled, type InstalledPlugin } from './install.js';
import { describePermissions, type PluginManifest } from './manifest.js';
import { assertPluginName } from './registry.js';
import { pluginDirFor, runPluginCommand, type ApiCall } from './sandboxed-context.js';
import {
  refuse,
  verifyPlugin,
  type PluginRegistry,
  type PublisherDirectory,
  type PublisherStatus,
  type VerifiedPlugin,
} from './verify.js';

/**
 * T4.2.3 (REVITION-CLI-PLAN.md:3119-3135) - search -> install -> use -> remove, with the org in charge:
 *   - the platform's registry index (`GET /dev/plugins`) must list the plugin, and say the caller's workspace allows it
 *     (org policy wins over user choice, invariant :3127) - checked at install AND at every run;
 *   - install = the T4.2.1 verification, the listing's publisher must equal the provenance publisher, then the T4.2.2
 *     permission prompt (AC3), then the write;
 *   - a run re-checks the listing and the publisher: a revoked publisher's plugin is disabled with a message (edge case
 *     :3090-3091), a disallowed one is refused; then the command runs in the sandbox.
 */

/** The plugin policy (ADR 0007): only verified plugins from registered publishers install; the org decides. */
export const PLUGIN_POLICY_URL = 'https://github.com/Revition/revition-cli/blob/main/docs/adr/0007-third-party-plugins.md';

export interface PluginIndexEntry {
  readonly name: string;
  readonly publisherId: string;
  readonly publisherName: string | null;
  readonly summary: string;
  readonly allowed: boolean;
}

export interface PluginIndex {
  search(q: string): Promise<readonly PluginIndexEntry[]>;
  /** null = not listed (never listed, delisted, or its publisher is no longer registered). */
  lookup(name: string): Promise<PluginIndexEntry | null>;
}

type Request = <T>(r: { method: 'GET'; path: string }) => Promise<{ body: T }>;

/** The platform's registry index and publisher registry, through the signed-in client. */
export function platformPlugins(request: Request): PluginIndex & PublisherDirectory {
  return {
    async search(q) {
      const qs = q.trim() === '' ? '' : `?q=${encodeURIComponent(q.trim())}`;
      return (await request<{ plugins: PluginIndexEntry[] }>({ method: 'GET', path: `/dev/plugins${qs}` })).body.plugins;
    },
    async lookup(name) {
      const r = await request<{ plugins: PluginIndexEntry[] }>({ method: 'GET', path: `/dev/plugins?name=${encodeURIComponent(name)}` });
      return r.body.plugins.find((p) => p.name === name) ?? null;
    },
    async status(publisherId) {
      const r = await request<{ status: PublisherStatus }>({ method: 'GET', path: `/dev/plugins/publishers/${encodeURIComponent(publisherId)}` });
      return r.body.status;
    },
  };
}

/** `name` or `name@version` (a scoped name keeps its leading @). PURE. */
export function parseSpec(spec: string): { readonly name: string; readonly range: string } {
  const at = spec.lastIndexOf('@');
  const [name, range] = at > 0 ? [spec.slice(0, at), spec.slice(at + 1)] : [spec, 'latest'];
  assertPluginName(name);
  if (range !== 'latest' && !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/u.test(range)) {
    throw new RevitionCliError({ code: 'PLUGIN_VERSION_INVALID', message: `"${range}" is not an exact version (or latest).` }, EXIT.usage);
  }
  return { name, range };
}

function notAllowed(name: string): RevitionCliError {
  return new RevitionCliError(
    { code: 'PLUGIN_NOT_ALLOWED', message: `Your workspace does not allow the plugin ${name}.`, hint: 'An Owner or Admin sets the allowed plugins under Command-line access.' },
    EXIT.permission
  );
}

async function listedAndAllowed(index: PluginIndex, name: string): Promise<PluginIndexEntry> {
  const entry = await index.lookup(name);
  if (entry === null) {
    throw new RevitionCliError(
      {
        code: 'PLUGIN_NOT_LISTED',
        message: `Refused: ${name} is not in the Revition plugin registry (or its publisher is no longer registered).`,
        hint: `Only verified plugins from registered publishers install (plugin policy: ${PLUGIN_POLICY_URL}). Search with \`revition plugins search\`.`,
      },
      EXIT.permission
    );
  }
  if (!entry.allowed) throw notAllowed(name);
  return entry;
}

export interface InstallDeps {
  readonly registry: PluginRegistry;
  readonly index: PluginIndex;
  readonly publishers: PublisherDirectory;
  readonly configDir: string;
  /** Shown the permission lines (AC3); resolves false to cancel. */
  readonly confirm: (p: { readonly name: string; readonly version: string; readonly permissions: readonly string[] }) => Promise<boolean>;
  readonly nowIso: () => string;
  /** The T4.2.1 verification (default: the real one; a test may pass its own for a locally built package). */
  readonly verify?: typeof verifyPlugin;
}

export interface PreparedInstall {
  readonly verified: VerifiedPlugin;
  readonly files: ReadonlyMap<string, Buffer>;
  readonly manifest: PluginManifest;
  /** The permission lines the user confirms (AC3). */
  readonly permissions: readonly string[];
}

/** Every check, nothing written: listed + allowed, verified, publisher match, a valid bundled package. */
export async function prepareInstall(
  spec: string,
  deps: Pick<InstallDeps, 'registry' | 'index' | 'publishers'> & { readonly verify?: typeof verifyPlugin }
): Promise<PreparedInstall> {
  const { name, range } = parseSpec(spec);
  const entry = await listedAndAllowed(deps.index, name);
  const verified = await (deps.verify ?? verifyPlugin)({ name, range }, { registry: deps.registry, publishers: deps.publishers });
  if (verified.publisherId !== entry.publisherId) {
    throw refuse('PLUGIN_PROVENANCE_INVALID', `${name} was built by ${verified.publisherId}, not by its registered publisher ${entry.publisherId}.`);
  }
  const files = unpackTarball(verified.tarball);
  const manifest = manifestOf(files);
  return { verified, files, manifest, permissions: describePermissions(manifest) };
}

export function commitInstall(p: PreparedInstall, configDir: string, nowIso: string): Promise<InstalledPlugin> {
  return writeInstalled(configDir, p.verified, p.files, p.manifest, nowIso);
}

export async function installPlugin(spec: string, deps: InstallDeps): Promise<InstalledPlugin> {
  const p = await prepareInstall(spec, deps);
  if (!(await deps.confirm({ name: p.verified.name, version: p.verified.version, permissions: p.permissions }))) {
    throw new RevitionCliError({ code: 'CANCELLED', message: 'Nothing was installed.' }, EXIT.cancelled);
  }
  return commitInstall(p, deps.configDir, deps.nowIso());
}

export interface RunDeps {
  readonly index: PluginIndex;
  readonly publishers: PublisherDirectory;
  readonly configDir: string;
  readonly projectRoot: string;
  readonly api: (call: ApiCall) => Promise<{ readonly status: number; readonly body: unknown }>;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export async function runInstalledPlugin(name: string, command: string, argv: readonly string[], deps: RunDeps): Promise<number> {
  const rec = (await listInstalled(deps.configDir)).find((p) => p.name === name);
  if (rec === undefined) {
    throw new RevitionCliError({ code: 'PLUGIN_NOT_INSTALLED', message: `${name} is not installed.`, hint: `revition plugins install ${name}` }, EXIT.notFound);
  }
  const status = await deps.publishers.status(rec.publisherId);
  if (status !== 'registered') {
    throw refuse(
      status === 'revoked' ? 'PLUGIN_PUBLISHER_REVOKED' : 'PLUGIN_PUBLISHER_UNREGISTERED',
      `${name} is disabled: its publisher ${rec.publisherId} is no longer registered with Revition.`,
      `Remove it with \`revition plugins remove ${name}\`.`
    );
  }
  const entry = await listedAndAllowed(deps.index, name);
  if (entry.publisherId !== rec.publisherId) throw refuse('PLUGIN_PROVENANCE_INVALID', `${name}'s registered publisher changed; reinstall it.`);
  const manifest = await installedManifest(deps.configDir, name);
  if (manifest.commands[command] === undefined) {
    throw new RevitionCliError(
      { code: 'PLUGIN_COMMAND_UNKNOWN', message: `${name} has no command "${command}".`, hint: `Its commands: ${Object.keys(manifest.commands).join(', ')}` },
      EXIT.usage
    );
  }
  return runPluginCommand(
    { pluginDir: pluginDirFor(deps.configDir, name), manifest, command, argv, projectRoot: deps.projectRoot },
    { api: deps.api, ...(deps.env === undefined ? {} : { env: deps.env }) }
  );
}

export async function removePlugin(name: string, configDir: string): Promise<boolean> {
  assertPluginName(name);
  return removeInstalled(configDir, name);
}
