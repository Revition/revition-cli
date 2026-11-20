// T4.1.1 (REVITION-CLI-PLAN.md:2962-2987) - the standalone `revition` executable: a Node Single Executable Application.
//
//   node scripts/build-sea.mjs [--out dist-sea]      builds revition-<platform>-<arch>[.exe] for THIS machine and
//                                                    appends its line to <out>/SHA256SUMS (the release matrix runs it
//                                                    once per target: darwin-arm64/x64, linux-x64/arm64, win32-x64)
//
// What is inside (ADR 0006): the SEA's main is a small CommonJS bootstrap; its one asset is the production deploy of
// @revition/cli (the same commit and lockfile as the npm package, its plugins and the keychain native addon), as a
// gzipped tar whose sha256 is fixed in the bootstrap at build time. On first run the asset is checked against that
// sha256, unpacked into a per-user 0700 cache directory named by the sha256, and the CLI runs from there with the
// binary's own Node runtime (so the keychain addon loads as in the npm install). Later runs only check the marker.
// No network, no install script, and nothing outside the cache directory is written.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'dist-sea');
const TARGET = `${process.platform}-${process.arch}`;
const EXE = `revition-${TARGET}${process.platform === 'win32' ? '.exe' : ''}`;
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
// The Node binary the executable is made from: an OFFICIAL nodejs.org build (it carries the SEA fuse; some distro
// builds do not). In the release workflow that is actions/setup-node's; locally pass --node <path>.
const BASE = process.argv.includes('--node') ? process.argv[process.argv.indexOf('--node') + 1] : process.execPath;

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

/** The bootstrap (CommonJS, builtins only). `sha` is the asset's sha256, fixed here at build time. */
export function bootstrapSource(sha) {
  return `'use strict';
const { getAsset } = require('node:sea');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { createRequire } = require('node:module');
const SHA = ${JSON.stringify(sha)};
function cacheBase() {
  const e = process.env;
  if (process.platform === 'win32') return path.join(e.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'revition', 'cache');
  if (e.XDG_CACHE_HOME) return path.join(e.XDG_CACHE_HOME, 'revition');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'revition');
  return path.join(os.homedir(), '.cache', 'revition');
}
function fail(msg) { process.stderr.write('revition: ' + msg + '\\n'); process.exit(1); }
const dir = path.join(cacheBase(), 'sea', SHA);
if (!fs.existsSync(path.join(dir, '.complete'))) {
  const buf = Buffer.from(getAsset('app.tgz'));
  if (crypto.createHash('sha256').update(buf).digest('hex') !== SHA) fail('the embedded application does not match its checksum; refusing to run.');
  fs.mkdirSync(path.dirname(dir), { recursive: true, mode: 0o700 });
  const tmp = fs.mkdtempSync(dir + '.tmp-');
  fs.chmodSync(tmp, 0o700);
  const tgz = path.join(tmp, 'app.tgz');
  const out = path.join(tmp, 'app');
  fs.writeFileSync(tgz, buf, { mode: 0o600 });
  fs.mkdirSync(out, { mode: 0o700 });
  const r = cp.spawnSync('tar', ['-xzf', tgz, '-C', out], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) { fs.rmSync(tmp, { recursive: true, force: true }); fail('could not unpack the embedded application (tar ' + r.status + ').'); }
  fs.writeFileSync(path.join(out, '.complete'), SHA);
  try { fs.renameSync(out, dir); } catch (e) { if (!fs.existsSync(path.join(dir, '.complete'))) throw e; }
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.env.REVITION_STANDALONE = SHA.slice(0, 12);
createRequire(path.join(dir, 'sea-entry.cjs'))(path.join(dir, 'sea-entry.cjs'));
`;
}

/** The entry inside the unpacked tree: the same oclif start as bin/run, with the user's own arguments. */
const ENTRY = `'use strict';
const { pathToFileURL } = require('node:url');
const path = require('node:path');
process.argv = [process.execPath, path.join(__dirname, 'bin', 'run'), ...process.argv.slice(process.argv[1] === process.execPath ? 2 : 1)];
import(pathToFileURL(require.resolve('@oclif/core', { paths: [__dirname] })).href).then((oclif) =>
  oclif.execute({ dir: pathToFileURL(path.join(__dirname, 'bin', 'run')).href })
);
`;

function main() {
  const work = mkdtempSync(join(tmpdir(), 'revition-sea-'));
  const app = join(work, 'app');
  // The same commit and lockfile as the npm package: the production deploy of @revition/cli (built first).
  run('pnpm', ['--filter', '@revition/cli', 'deploy', '--prod', '--legacy', app], { cwd: ROOT });
  writeFileSync(join(app, 'sea-entry.cjs'), ENTRY);
  const tgz = join(work, 'app.tgz');
  run('tar', ['-czf', tgz, '-C', app, '.']);
  const sha = createHash('sha256').update(readFileSync(tgz)).digest('hex');
  writeFileSync(join(work, 'sea-main.cjs'), bootstrapSource(sha));
  writeFileSync(
    join(work, 'sea-config.json'),
    JSON.stringify({ main: 'sea-main.cjs', output: 'sea-prep.blob', disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, assets: { 'app.tgz': 'app.tgz' } })
  );
  run(BASE, ['--experimental-sea-config', 'sea-config.json'], { cwd: work });
  mkdirSync(OUT, { recursive: true });
  const exe = join(OUT, EXE);
  rmSync(exe, { force: true });
  copyFileSync(BASE, exe);
  chmodSync(exe, 0o755);
  if (process.platform === 'darwin') run('codesign', ['--remove-signature', exe]);
  const inject = ['exec', 'postject', exe, 'NODE_SEA_BLOB', join(work, 'sea-prep.blob'), '--sentinel-fuse', FUSE];
  if (process.platform === 'darwin') inject.push('--macho-segment-name', 'NODE_SEA');
  run('pnpm', inject, { cwd: ROOT });
  // macOS arm64 runs only signed code: an AD-HOC signature here (no identity, no cost). The Developer ID signature and
  // notarization are T4.1.2, decided with the signing costs (REMEDIATION-ROUND-PLAN.md:44).
  if (process.platform === 'darwin') run('codesign', ['--sign', '-', exe]);
  const digest = createHash('sha256').update(readFileSync(exe)).digest('hex');
  const sums = join(OUT, 'SHA256SUMS');
  const prior = existsSync(sums) ? readFileSync(sums, 'utf8').split('\n').filter((l) => l !== '' && !l.endsWith(`  ${EXE}`)) : [];
  writeFileSync(sums, `${[...prior, `${digest}  ${EXE}`].join('\n')}\n`);
  appendFileSync(join(OUT, 'build.log'), `${new Date().toISOString()} ${EXE} ${statSync(exe).size} bytes app-sha256 ${sha}\n`);
  rmSync(work, { recursive: true, force: true });
  process.stdout.write(`built ${exe}\nsha256 ${digest}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
