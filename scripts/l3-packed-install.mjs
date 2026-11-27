#!/usr/bin/env node
/**
 * L3 Functional (black-box), REVITION-CLI-PLAN.md:3265 + :3270: "npm pack -> npm i ... the REAL `revition` binary",
 * then the real-process suites run against that installed artifact instead of the source tree.
 *
 *   node scripts/l3-packed-install.mjs <out-dir>
 *
 * 1. release build (`pnpm -r build`);
 * 2. `pnpm pack` every publishable workspace package (workspace:* rewritten to real versions by pnpm);
 * 3. npm installs the packed tarballs into a FRESH prefix. The siblings are not on the registry, so the throwaway root
 *    maps each one to its tarball with `overrides`; third-party dependencies come from the npm registry;
 * 4. `revition --version` / `--help` from the installed bin, through a pipe AND through a real PTY (`script` on
 *    macOS / Linux);
 * 5. the real-process suites (every `*.test.ts` that drives the CLI through test-fixtures/spawn-cli) run with
 *    REVITION_L3_BIN = the installed bin, junit + JSON summary written to <out-dir>.
 * No network call is made by the suites (their servers are local mocks); the install reads the npm registry.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir, platform, release, arch } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = resolve(process.argv[2] ?? join(ROOT, 'l3-out'));
mkdirSync(OUT, { recursive: true });

/** The suites that run the CLI as a real child process (test-fixtures/spawn-cli.ts). */
export const L3_SUITES = [
  'src/fixture-plugin.test.ts',
  'src/plugin-guard.test.ts',
  'src/help-and-doctor.test.ts',
  'src/envelope.test.ts',
  'src/lifecycle-e2e.test.ts',
  'src/login-e2e.test.ts',
  'src/deprecation-warning.test.ts',
  'src/command-reference.test.ts',
  'test/json-schema-conformance.test.ts',
  // The black-box clauses with a real PTY, shells, proxy, TLS and npm (test/l3-rig.ts).
  'test/l3-installed.test.ts',
];

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 << 20 });
}

function publishable() {
  const dirs = [];
  for (const group of ['packages', 'plugins']) {
    const base = join(ROOT, group);
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base)) {
      const pj = join(base, d, 'package.json');
      if (!existsSync(pj)) continue;
      // The CLI and every package it loads at runtime are public (publishConfig.access public); test-kit stays
      // `private: true`. `pack` produces the exact artifact `publish` would upload, so every package is packed.
      const m = JSON.parse(readFileSync(pj, 'utf8'));
      dirs.push({ dir: join(base, d), name: m.name, version: m.version });
    }
  }
  return dirs;
}

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const startedAt = new Date().toISOString();
run('pnpm', ['-r', '--if-present', 'run', 'build'], ROOT);

const work = mkdtempSync(join(tmpdir(), 'revition-l3-'));
const packs = join(work, 'packs');
mkdirSync(packs);
const tarballs = [];
for (const p of publishable()) {
  const before = new Set(readdirSync(packs));
  run('pnpm', ['pack', '--pack-destination', packs], p.dir);
  const made = readdirSync(packs).filter((f) => !before.has(f) && f.endsWith('.tgz'));
  if (made.length !== 1) throw new Error(`pack of ${p.name} produced ${made.length} tarballs`);
  const file = join(packs, made[0]);
  tarballs.push({ name: p.name, version: p.version, file, sha256: sha256(file) });
}

const prefix = join(work, 'prefix');
mkdirSync(prefix);
const cli = tarballs.find((t) => t.name === '@revition/cli');
if (cli === undefined) throw new Error('no @revition/cli tarball');
const overrides = Object.fromEntries(tarballs.map((t) => [t.name, `file:${t.file}`]));
writeFileSync(
  join(prefix, 'package.json'),
  JSON.stringify({ name: 'revition-l3-root', private: true, dependencies: { '@revition/cli': `file:${cli.file}` }, overrides }, null, 2)
);
run('npm', ['install', '--no-audit', '--no-fund', '--install-links', '--omit=dev'], prefix);

const bin = join(prefix, 'node_modules', '.bin', 'revition');
if (!existsSync(bin)) throw new Error(`no installed bin at ${bin}`);
const installedPkg = realpathSync(join(prefix, 'node_modules', '@revition', 'cli'));
if (installedPkg.startsWith(ROOT)) throw new Error('the installed package resolves into the source tree (not a packed install)');

const version = run(process.execPath, [bin, '--version'], prefix).trim();
const piped = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
// A real PTY: `script` allocates one (BSD form on macOS, util-linux form on Linux).
const pty =
  platform() === 'darwin'
    ? spawnSync('script', ['-q', '/dev/null', process.execPath, bin, '--help'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : platform() === 'linux'
      ? spawnSync('script', ['-qec', `${process.execPath} ${bin} --help`, '/dev/null'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      : { status: null, stdout: '', stderr: 'no PTY helper on this OS' };

// The installed CLI's `upgrade` really runs `npm install --global` (L3 run-2 on 2026-11-18 installed the registry
// placeholder into the machine's global prefix). Every npm global operation from the suites goes to a sandbox prefix
// inside this job's temp dir, never the machine's.
const npmSandbox = join(work, 'npm-global-sandbox');
mkdirSync(npmSandbox);
const suiteEnv = {
  ...process.env,
  REVITION_L3_BIN: bin,
  npm_config_prefix: npmSandbox,
  NPM_CONFIG_PREFIX: npmSandbox,
  npm_config_update_notifier: 'false',
};

// plugin-dev's real-process suites (T2.1.1 AC2 starter traversal guard, T2.1.4 AC3 upload secret refusal, CLI:1980,
// :2073 "on the installed CLI"): their own test-fixtures/mock-platform.ts drives REVITION_L3_BIN.
// T2.1.3 L3 (CLI:2037): `test` (and `dev --local`, its engine) on the installed CLI, offline.
const PLUGIN_DEV_SUITES = ['src/init.test.ts', 'src/dev.test.ts', 'src/test-command.test.ts'];
const pluginJunit = join(OUT, 'l3-plugin-dev-junit.xml');
const pluginSuites = spawnSync(
  process.execPath,
  [
    '--conditions=revition-source',
    '--import',
    'tsx',
    '--test',
    '--test-concurrency=1',
    '--test-reporter=junit',
    `--test-reporter-destination=${pluginJunit}`,
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    ...PLUGIN_DEV_SUITES,
  ],
  { cwd: join(ROOT, 'plugins', 'plugin-dev'), encoding: 'utf8', env: suiteEnv, maxBuffer: 256 << 20 }
);
writeFileSync(join(OUT, 'l3-plugin-dev-suites.txt'), `${pluginSuites.stdout}\n${pluginSuites.stderr}`);

const junit = join(OUT, 'l3-junit.xml');
const suites = spawnSync(
  process.execPath,
  [
    '--conditions=revition-source',
    '--import',
    'tsx',
    '--test',
    '--test-concurrency=1',
    '--test-reporter=junit',
    `--test-reporter-destination=${junit}`,
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    ...L3_SUITES,
  ],
  { cwd: join(ROOT, 'packages', 'cli'), encoding: 'utf8', env: suiteEnv, maxBuffer: 256 << 20 }
);
writeFileSync(join(OUT, 'l3-suites.txt'), `${suites.stdout}\n${suites.stderr}`);

const xml = existsSync(junit) ? readFileSync(junit, 'utf8') : '';
const count = (re) => (xml.match(re) ?? []).length;
const summary = {
  startedAt,
  finishedAt: new Date().toISOString(),
  os: { platform: platform(), release: release(), arch: arch() },
  node: process.version,
  commit: run('git', ['rev-parse', 'HEAD'], ROOT).trim(),
  dirty: run('git', ['status', '--porcelain'], ROOT).trim().split('\n').filter(Boolean),
  tarballs: tarballs.map((t) => ({ name: t.name, version: t.version, file: t.file.split('/').pop(), sha256: t.sha256 })),
  install: { prefix, bin, installedPackage: installedPkg, installedFromSourceTree: installedPkg.startsWith(ROOT) },
  version,
  helpPiped: { exit: piped.status, isHelp: /USAGE|COMMANDS/u.test(piped.stdout) },
  // In a PTY the help is styled (bold section titles): the ANSI codes are the proof stdout was a terminal.
  helpPty: {
    exit: pty.status,
    isHelp: /USAGE|COMMANDS/u.test(pty.stdout ?? ''),
    styled: (pty.stdout ?? '').includes('\u001b['),
    pipedStyled: piped.stdout.includes('\u001b['),
  },
  suites: {
    files: L3_SUITES,
    exit: suites.status,
    testcases: count(/<testcase\b/gu),
    failures: count(/<failure\b/gu),
    skipped: count(/<skipped\b/gu),
  },
  pluginDevSuites: (() => {
    const px = existsSync(pluginJunit) ? readFileSync(pluginJunit, 'utf8') : '';
    return {
      files: PLUGIN_DEV_SUITES,
      exit: pluginSuites.status,
      testcases: (px.match(/<testcase\b/gu) ?? []).length,
      failures: (px.match(/<failure\b/gu) ?? []).length,
    };
  })(),
};
writeFileSync(join(OUT, 'l3-summary.json'), JSON.stringify(summary, null, 2));
process.stdout.write(
  `${JSON.stringify(summary.suites)} pluginDev=${JSON.stringify(summary.pluginDevSuites)} version=${version} pty=${summary.helpPty.isHelp}\n`
);
const green = suites.status === 0 && pluginSuites.status === 0 && summary.helpPiped.isHelp && summary.helpPty.isHelp;
process.exit(green ? 0 : 1);
