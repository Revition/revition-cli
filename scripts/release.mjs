// T1.5.2 - the release workflow's local steps (release.yml calls these; no token is read or written here).
//   node scripts/release.mjs canary-version <commit sha>   every workspace package -> X.Y.Z-canary.<sha7>
//   node scripts/release.mjs pack <out dir>                 `pnpm pack` of every PUBLIC package + manifest.json
//   node scripts/release.mjs channel <version>              the dist-tag a pushed release goes to (never `latest` for a prerelease)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHANNELS = ['canary', 'next', 'latest'];

/** `0.2.0` or `0.2.0-next.1` + a sha -> `0.2.0-canary.abc1234`. PURE. */
export function canaryVersion(version, sha) {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new Error(`not a commit sha: ${sha}`);
  const base = version.split('-')[0];
  if (!/^\d+\.\d+\.\d+$/.test(base)) throw new Error(`not a version: ${version}`);
  return `${base}-canary.${sha.slice(0, 7)}`;
}

/**
 * The dist-tag a version may be published under. A canary build only ever goes to `canary`; a prerelease never to
 * `latest`; `latest` must be asked for explicitly (workflow_dispatch). PURE.
 */
export function channelFor(version, requested) {
  const pre = version.includes('-');
  if (/-canary\./.test(version)) return 'canary';
  if (requested === 'canary') throw new Error('a non-canary version is never published to canary');
  if (requested === 'latest') {
    if (pre) throw new Error(`a prerelease (${version}) is never tagged latest`);
    return 'latest';
  }
  return 'next';
}

export function workspacePackages(root) {
  return ['packages', 'plugins']
    .map((group) => join(root, group))
    .filter((dir) => existsSync(dir))
    .flatMap((dir) =>
      readdirSync(dir)
        .filter((d) => existsSync(join(dir, d, 'package.json')))
        .map((d) => ({ dir: join(dir, d), json: JSON.parse(readFileSync(join(dir, d, 'package.json'), 'utf8')) }))
    );
}

export function setCanaryVersions(root, sha) {
  for (const p of workspacePackages(root)) {
    const next = { ...p.json, version: canaryVersion(p.json.version, sha) };
    writeFileSync(join(p.dir, 'package.json'), `${JSON.stringify(next, null, 2)}\n`);
  }
}

/** Packs every public package (pnpm rewrites `workspace:*` to real versions) and writes manifest.json. */
export function packPublic(root, out) {
  mkdirSync(out, { recursive: true });
  const manifest = [];
  for (const p of workspacePackages(root).filter((x) => x.json.private !== true)) {
    const before = new Set(readdirSync(out));
    execFileSync('pnpm', ['pack', '--pack-destination', out], { cwd: p.dir, stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
    const file = readdirSync(out).find((f) => f.endsWith('.tgz') && !before.has(f));
    if (file === undefined) throw new Error(`pnpm pack produced nothing for ${p.json.name}`);
    manifest.push({ name: p.json.name, version: p.json.version, file });
  }
  if (manifest.length === 0) throw new Error('no public package to release (every package is private)');
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, arg, requested] = process.argv.slice(2);
  const root = process.cwd();
  if (cmd === 'canary-version') setCanaryVersions(root, arg ?? '');
  else if (cmd === 'pack') console.log(JSON.stringify(packPublic(root, resolve(arg ?? 'release-artifacts'))));
  else if (cmd === 'channel') console.log(channelFor(arg ?? '', requested ?? 'next'));
  else {
    console.error('usage: release.mjs canary-version <sha> | pack <dir> | channel <version> [requested]');
    process.exit(2);
  }
}
