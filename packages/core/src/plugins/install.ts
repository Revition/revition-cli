import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { RevitionCliError } from '../errors/cli-error.js';
import { EXIT } from '../output/exit-codes.js';

import { MANIFEST_FILE, parseManifest, type PluginManifest } from './manifest.js';
import { pluginDirFor } from './sandboxed-context.js';
import type { VerifiedPlugin } from './verify.js';

/**
 * T4.2.3 - unpacking a VERIFIED plugin and the record of what is installed (`<config dir>/plugins/installed.json`).
 * The tarball is read in memory (it was integrity-checked against the registry); only regular files and folders are
 * accepted (a link, a device, an absolute path or a `..` refuses the whole package), and NO install script ever runs:
 * a plugin ships bundled (its `dependencies` must be bundled inside the package). Writes go to a staging folder that is
 * renamed into place only when everything checked out.
 */

export interface InstalledPlugin {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
  readonly publisherId: string;
  readonly builtBy: string;
  readonly permissions: readonly string[];
  readonly commands: Readonly<Record<string, { readonly summary: string }>>;
  readonly installedAt: string;
}

function badPackage(why: string): RevitionCliError {
  return new RevitionCliError({ code: 'PLUGIN_PACKAGE_INVALID', message: `The plugin package is refused: ${why}.` }, EXIT.permission);
}

/** A gzipped npm tarball as files (path inside the package -> bytes). Refuses links and escaping paths. PURE. */
export function unpackTarball(tgz: Buffer): Map<string, Buffer> {
  const tar = gunzipSync(tgz);
  const files = new Map<string, Buffer>();
  let off = 0;
  let longName: string | null = null;
  while (off + 512 <= tar.length) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a: number, n: number): string => h.subarray(a, a + n).toString('utf8').replace(/\0.*$/su, '');
    const size = parseInt(str(124, 12).trim() || '0', 8);
    const type = String.fromCharCode(h[156] ?? 0);
    const prefix = str(345, 155);
    let path = longName ?? (prefix !== '' ? `${prefix}/${str(0, 100)}` : str(0, 100));
    longName = null;
    const body = tar.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x' || type === 'g') {
      const m = /\d+ path=([^\n]+)\n/u.exec(body.toString('utf8'));
      if (type === 'x' && m !== null) longName = m[1] ?? null;
      continue;
    }
    if (type === 'L') {
      longName = body.toString('utf8').replace(/\0.*$/su, '');
      continue;
    }
    if (type === '5') continue;
    if (type !== '0' && type !== '\0') throw badPackage(`it contains a link or special file (${path})`);
    path = path.replace(/^package\//u, '');
    const norm = normalize(path);
    if (path === '' || path.startsWith('/') || /^[A-Za-z]:/u.test(path) || norm.split(/[\\/]/u).includes('..')) {
      throw badPackage(`a path leaves the package (${path})`);
    }
    files.set(norm.split(sep).join('/'), Buffer.from(body));
  }
  return files;
}

/** The manifest, plus the bundled-dependencies rule. PURE. */
export function manifestOf(files: ReadonlyMap<string, Buffer>): PluginManifest {
  const m = files.get(MANIFEST_FILE);
  if (m === undefined) throw badPackage(`it has no ${MANIFEST_FILE} (not a Revition CLI plugin)`);
  const manifest = parseManifest(m.toString('utf8'));
  const pkg = JSON.parse(files.get('package.json')?.toString('utf8') ?? '{}') as { dependencies?: Record<string, string> };
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    if (!files.has(`node_modules/${dep}/package.json`)) throw badPackage(`its dependency ${dep} is not bundled (no install scripts or downloads run at install)`);
  }
  for (const c of Object.values(manifest.commands)) {
    if (!files.has(normalize(c.entry).split(sep).join('/'))) throw badPackage(`the command entry ${c.entry} is not in the package`);
  }
  return manifest;
}

export function installedFile(configDir: string): string {
  return join(configDir, 'plugins', 'installed.json');
}

export async function listInstalled(configDir: string): Promise<InstalledPlugin[]> {
  const f = installedFile(configDir);
  if (!existsSync(f)) return [];
  const raw = JSON.parse(await readFile(f, 'utf8')) as { plugins?: InstalledPlugin[] };
  return raw.plugins ?? [];
}

async function saveInstalled(configDir: string, plugins: readonly InstalledPlugin[]): Promise<void> {
  const f = installedFile(configDir);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(`${f}.tmp`, `${JSON.stringify({ plugins }, null, 2)}\n`, { mode: 0o600 });
  await rename(`${f}.tmp`, f);
}

/** Writes the verified, unpacked plugin into place and records it (replacing an older version). */
export async function writeInstalled(
  configDir: string,
  v: VerifiedPlugin,
  files: ReadonlyMap<string, Buffer>,
  manifest: PluginManifest,
  nowIso: string
): Promise<InstalledPlugin> {
  const dir = pluginDirFor(configDir, v.name);
  const staging = `${dir}.staging-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  for (const [p, bytes] of files) {
    const target = join(staging, p);
    if (!target.startsWith(staging + sep)) throw badPackage(`a path leaves the package (${p})`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { mode: 0o644 });
  }
  await rm(dir, { recursive: true, force: true });
  await rename(staging, dir);
  const record: InstalledPlugin = {
    name: v.name,
    version: v.version,
    integrity: v.integrity,
    publisherId: v.publisherId,
    builtBy: v.builtBy,
    permissions: manifest.permissions,
    commands: Object.fromEntries(Object.entries(manifest.commands).map(([k, c]) => [k, { summary: c.summary }])),
    installedAt: nowIso,
  };
  const rest = (await listInstalled(configDir)).filter((p) => p.name !== v.name);
  await saveInstalled(configDir, [...rest, record].sort((a, b) => a.name.localeCompare(b.name)));
  return record;
}

export async function removeInstalled(configDir: string, name: string): Promise<boolean> {
  const all = await listInstalled(configDir);
  if (!all.some((p) => p.name === name)) return false;
  await rm(pluginDirFor(configDir, name), { recursive: true, force: true });
  await saveInstalled(configDir, all.filter((p) => p.name !== name));
  return true;
}

/** The installed plugin's manifest, read from its folder (the file installed from the verified package). */
export async function installedManifest(configDir: string, name: string): Promise<PluginManifest> {
  return parseManifest(await readFile(join(pluginDirFor(configDir, name), MANIFEST_FILE), 'utf8'));
}
