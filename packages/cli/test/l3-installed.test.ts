/**
 * L3 Functional, black-box (REVITION-CLI-PLAN.md:3265): the REAL `revition` binary (the packed artifact when
 * scripts/l3-packed-install.mjs sets REVITION_L3_BIN, else this tree's bin) against real paths, a real PTY, real
 * shells, a real proxy and a real TLS server (test/l3-rig.ts). One test per plan L3 clause, tagged with its row:
 *   T1.1.2 :824  real config paths, precedence from real env vars + project files, the custom-host warning
 *   T1.1.3 :865  a real PTY vs a pipe (colour, NO_COLOR), no prompts when piped, `--json` parsed by jq, exit codes read
 *                by the shell ($?) per class against a mock server
 *   T1.1.5 :944  a local TLS server (untrusted refused), a real HTTP proxy, NODE_EXTRA_CA_CERTS, Retry-After
 *   T1.4.1 :1642 the update notice on a TTY and never in --json / CI / a pipe; `upgrade` really upgrades a global install
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { CLI_BIN } from '../src/test-fixtures/spawn-cli.js';

import { baseEnv, closedPort, makePki, run, startProxy, startStatusMock, startTlsMock, type Pki } from './l3-rig.js';

const PAT = `rvt_${'L'.repeat(40)}`;
const NODE = process.execPath;
const INSTALLED = process.env['REVITION_L3_BIN'] !== undefined;
const ESC = '\u001b[';
const SPINNER = /[⠀-⣿]/u;

const home = (): string => mkdtempSync(join(tmpdir(), 'rvl3-home-'));
const cli = (args: readonly string[], env: Record<string, string | undefined>, cwd?: string) => run(NODE, [CLI_BIN, ...args], env, cwd);

/** The real PTY: `script` allocates one (BSD form on macOS, util-linux on Linux). Windows needs node-pty (CI matrix). */
function inPty(args: readonly string[], env: Record<string, string | undefined>): ReturnType<typeof run> {
  if (process.platform === 'darwin') return run('script', ['-q', '/dev/null', NODE, CLI_BIN, ...args], env, undefined, 60_000, 'ignore');
  if (process.platform === 'linux') {
    const line = [NODE, CLI_BIN, ...args].map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
    return run('script', ['-qec', line, '/dev/null'], env, undefined, 60_000, 'ignore');
  }
  throw new Error(`no PTY helper on ${process.platform} (the Windows L3 job drives ConPTY through node-pty)`);
}

/** Where this OS keeps the user config for `home` (the plan's path table, paths.ts). */
function expectedConfigFile(h: string): string {
  if (process.platform === 'darwin') return join(h, 'Library', 'Application Support', 'revition', 'config.json');
  if (process.platform === 'win32') return join(h, 'AppData', 'Roaming', 'revition', 'config.json');
  return join(h, '.config', 'revition', 'config.json');
}

const envelope = (stdout: string): { ok: boolean; data: Record<string, unknown> | null; error: unknown } =>
  JSON.parse(stdout) as { ok: boolean; data: Record<string, unknown> | null; error: unknown };

const hostLine = (stdout: string): string =>
  String(((envelope(stdout).data?.['checks'] as Array<{ id: string; message: string }>) ?? []).find((c) => c.id === 'host')?.message ?? '');

let pki: Pki;
let tls: Awaited<ReturnType<typeof startTlsMock>>;
let proxy: Awaited<ReturnType<typeof startProxy>>;

before(async () => {
  pki = makePki();
  tls = await startTlsMock(pki);
  proxy = await startProxy(tls.port);
});

after(() => {
  proxy.close();
  tls.close();
});

describe(`L3 on the ${INSTALLED ? 'INSTALLED packed artifact' : 'source bin'}: config (T1.1.2)`, () => {
  it('[CLI-T1.1.2-AC3] the CLI writes its config to this OS real path, file mode 0600', async () => {
    const h = home();
    const r = await cli(['config', 'set', 'telemetry', 'off', '--json'], baseEnv(h));
    assert.equal(r.code, 0, r.stderr);
    const file = String(envelope(r.stdout).data?.['file']);
    assert.equal(file, expectedConfigFile(h));
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).telemetry, 'off');
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  });

  it('[CLI-T1.1.2-AC1] precedence with real env vars and a real project file: flags > env > project > user', async () => {
    const h = home();
    const env = baseEnv(h, { HTTPS_PROXY: proxy.url, NODE_EXTRA_CA_CERTS: pki.caFile });
    assert.equal((await cli(['config', 'set', 'profiles.work.host', 'work.revition.com'], env)).code, 0);
    const project = mkdtempSync(join(tmpdir(), 'rvl3-proj-'));
    mkdirSync(join(project, '.revition'));
    writeFileSync(join(project, '.revition', 'project.json'), JSON.stringify({ schemaVersion: 1, appId: null, projectId: null, profile: 'work' }));
    const elsewhere = mkdtempSync(join(tmpdir(), 'rvl3-cwd-'));
    const doctor = async (extra: Record<string, string>, cwd: string, flags: readonly string[] = []): Promise<string> =>
      hostLine((await cli(['doctor', '--json', ...flags], { ...env, ...extra }, cwd)).stdout);
    assert.match(await doctor({}, elsewhere), /^api\.revition\.com /u, 'user / defaults: the default profile');
    assert.match(await doctor({}, project), /^work\.revition\.com /u, 'the project file beats the user config');
    assert.match(await doctor({ REVITION_PROFILE: 'default' }, project), /^api\.revition\.com /u, 'env beats the project file');
    assert.match(await doctor({ REVITION_HOST: 'env.revition.com' }, project), /^env\.revition\.com /u, 'env host beats the project');
    assert.match(await doctor({ REVITION_PROFILE: 'default' }, project, ['--profile', 'work']), /^work\.revition\.com /u, 'the flag beats env');
    // Every probe went through the local proxy to the local TLS mock: nothing reached a real host.
    assert.ok(proxy.events.some((e) => e.target === 'work.revition.com:443'));
  });

  it('[CLI-T1.1.2-AC4] a custom host is refused without --allow-custom-host; with it the warning is printed', async () => {
    const env = baseEnv(home());
    const refused = await cli(['config', 'set', 'profiles.x.host', 'evil.example'], env);
    assert.notEqual(refused.code, 0);
    assert.match(refused.stderr, /allow-custom-host/u);
    const allowed = await cli(['config', 'set', 'profiles.x.host', 'evil.example', '--allow-custom-host'], env);
    assert.equal(allowed.code, 0, allowed.stderr);
    assert.match(allowed.stderr, /custom host "evil\.example"/u);
    assert.match(allowed.stderr, /kept separately/u);
  });

  it('[CLI-T1.1.2-AC5] 20 concurrent CLI processes writing the config never corrupt it', async () => {
    const h = home();
    const env = baseEnv(h);
    const runs = await Promise.all(
      Array.from({ length: 20 }, (_v, i) => cli(['config', 'set', 'telemetry', i % 2 === 0 ? 'on' : 'off'], env))
    );
    assert.deepEqual(runs.map((r) => r.code), Array.from({ length: 20 }, () => 0));
    const file = expectedConfigFile(h);
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { telemetry: string; schemaVersion: number };
    assert.ok(['on', 'off'].includes(parsed.telemetry));
    assert.equal(parsed.schemaVersion, 1);
    const dir = join(file, '..');
    // On macOS the state directory lives inside the app folder by design (paths.ts); anything else is a leftover.
    const others = readdirSync(dir).filter((f) => f !== 'config.json' && !statSync(join(dir, f)).isDirectory());
    assert.deepEqual(others, [], 'no temp file is left behind');
  });
});

describe('L3: output, exit codes, a real PTY (T1.1.3)', () => {
  it('[CLI-T1.1.3-AC2] each error class gives its exit code, read by a real shell ($?); --json is parsed by jq', async () => {
    const classes: ReadonlyArray<readonly [number, number]> = [
      [401, 3], [403, 4], [404, 5], [409, 6], [429, 7], [500, 8], [426, 10], [402, 12],
    ];
    for (const [status, exit] of classes) {
      const mock = await startStatusMock(() => ({ status, headers: status === 429 ? { 'retry-after': '0' } : {} }));
      try {
        const env = baseEnv(home(), { REVITION_HOST: mock.host, REVITION_TOKEN: PAT });
        const shell = await run('/bin/sh', ['-c', '"$0" "$1" whoami --json >/dev/null 2>&1; echo "$?"', NODE, CLI_BIN], env);
        assert.equal(shell.stdout.trim(), String(exit), `HTTP ${status} -> exit ${exit}`);
        const jq = await run('/bin/sh', ['-c', '"$0" "$1" whoami --json 2>/dev/null | jq -e ".ok == false and .error.httpStatus == $2"', NODE, CLI_BIN, String(status)], env);
        assert.equal(jq.code, 0, `jq: HTTP ${status} ${jq.stdout}${jq.stderr}`);
      } finally {
        mock.close();
      }
    }
    const env = baseEnv(home(), { REVITION_HOST: `127.0.0.1:${await closedPort()}`, REVITION_TOKEN: PAT });
    const net = await run('/bin/sh', ['-c', '"$0" "$1" whoami >/dev/null 2>&1; echo "$?"', NODE, CLI_BIN], env);
    assert.equal(net.stdout.trim(), '9', 'nothing listening -> network class 9');
  });

  it('[CLI-T1.1.3-AC3] in a real PTY the output is styled; NO_COLOR=1 removes every ANSI code', async () => {
    const env = baseEnv(home(), { TERM: 'xterm-256color' });
    const styled = await inPty(['--help'], env);
    assert.ok(styled.stdout.includes(ESC), 'a TTY gets styling (the control)');
    const plain = await inPty(['--help'], { ...env, NO_COLOR: '1' });
    assert.match(plain.stdout, /USAGE/u);
    assert.ok(!plain.stdout.includes(ESC), 'NO_COLOR=1: zero ANSI codes in the PTY capture');
    const piped = await cli(['--help'], env);
    assert.ok(!piped.stdout.includes(ESC) && !piped.stderr.includes(ESC), 'a pipe: zero ANSI codes');
  });

  it('[CLI-T1.1.3-AC4] accessible mode (TERM=dumb or REVITION_ACCESSIBLE=1) draws no spinner frame in a real PTY', async () => {
    const mock = await startStatusMock(() => ({ status: 200, delayMs: 2_500 }));
    try {
      // A first interactive run asks for telemetry consent (T1.4.2) and long output pages on a TTY: a user who has
      // answered (DO_NOT_TRACK) with PAGER=cat, so the capture is the command's own output.
      const env = baseEnv(home(), { REVITION_HOST: mock.host, REVITION_TOKEN: PAT, DO_NOT_TRACK: '1', PAGER: 'cat' });
      for (const a11y of [{ TERM: 'dumb' }, { TERM: 'xterm-256color', REVITION_ACCESSIBLE: '1' }]) {
        const r = await inPty(['whoami'], { ...env, ...a11y });
        assert.equal(r.code, 0, r.stdout);
        assert.doesNotMatch(r.stdout, SPINNER, `${JSON.stringify(a11y)}: no braille spinner frame`);
      }
    } finally {
      mock.close();
    }
  });

  it('[CLI-T1.1.3-AC5] piped: no prompt and no animation; a confirming command fails fast with exit 2', async () => {
    const mock = await startStatusMock(() => ({ status: 200, delayMs: 2_500 }));
    try {
      const env = baseEnv(home(), { REVITION_HOST: mock.host, REVITION_TOKEN: PAT, TERM: 'xterm-256color' });
      const slow = await cli(['whoami'], env);
      assert.equal(slow.code, 0, slow.stderr);
      assert.doesNotMatch(`${slow.stdout}${slow.stderr}`, SPINNER);
      assert.ok(!slow.stderr.includes('\r') && !slow.stderr.includes(ESC), 'no redraws, no styling on a pipe');
      const confirm = await cli(['token', 'revoke', 'tok_1'], env);
      assert.equal(confirm.code, 2, confirm.stderr);
      assert.ok(confirm.ms < 15_000, `returned without waiting for input (${confirm.ms.toFixed(0)} ms)`);
      assert.doesNotMatch(confirm.stderr, /\(y\/N\)|\? /u, 'no prompt text on a pipe');
    } finally {
      mock.close();
    }
  });
});

describe('L3: completion in a real interactive shell (T1.1.6)', () => {
  // CLI:979 "completion is installed into a real bash / zsh / fish / pwsh session and tab-completes commands". This OS
  // has bash and zsh; fish and pwsh run on the CI matrix. `expect` types `revition con<TAB>` into the live shell.
  for (const shell of ['bash', 'zsh'] as const) {
    it(`[CLI-T1.1.6-AC3] ${shell}: the installed completion tab-completes a command and a subcommand`, async () => {
      const h = home();
      const comp = await cli(['autocomplete', shell], baseEnv(h));
      assert.equal(comp.code, 0, comp.stderr);
      const file = join(h, `revition-completion.${shell}`);
      writeFileSync(file, comp.stdout);
      const rc =
        shell === 'bash'
          ? `PS1='L3> '\nsource '${file}'\n`
          : `PROMPT='L3> '\nautoload -U compinit && compinit -u\nsource '${file}'\n`;
      writeFileSync(join(h, shell === 'bash' ? '.bashrc' : '.zshrc'), rc);
      const spawnLine = shell === 'bash' ? `spawn /bin/bash --noprofile --rcfile {${join(h, '.bashrc')}} -i` : 'spawn /bin/zsh -i';
      const tcl = [
        'set timeout 20',
        spawnLine,
        'expect "L3> " {} timeout { exit 90 }',
        'send "revition con\\t"',
        // `expect` consumes what it matched, so each step matches only the text the shell added (zsh styles the space).
        'expect -re {revition config} {} timeout { exit 91 }',
        'send "s\\t"',
        'expect -re {et} {} timeout { exit 92 }',
        'send "\\003"',
        'send "exit\\r"',
        'expect eof',
        'exit 0',
      ].join('\n');
      const r = await run('expect', ['-c', tcl], baseEnv(h, { ZDOTDIR: h, TERM: 'xterm-256color', SHELL: `/bin/${shell}` }), h, 60_000, 'ignore');
      assert.equal(r.code, 0, `${shell} session:\n${r.stdout}`);
    });
  }
});

describe('L3: transport through a real proxy and a real TLS server (T1.1.5)', () => {
  it('[CLI-T1.1.5-AC1] an untrusted TLS server is refused (exit 9), even with NODE_TLS_REJECT_UNAUTHORIZED=0', async () => {
    const env = baseEnv(home(), { REVITION_HOST: 'l3.revition.com', REVITION_TOKEN: PAT, HTTPS_PROXY: proxy.url });
    assert.equal((await cli(['whoami'], env)).code, 9);
    assert.equal((await cli(['whoami'], { ...env, NODE_TLS_REJECT_UNAUTHORIZED: '0' })).code, 9);
  });

  it('[CLI-T1.1.5-AC4] HTTPS_PROXY is used (CONNECT seen at the proxy); NODE_EXTRA_CA_CERTS is honoured; NO_PROXY bypasses it', async () => {
    const before = proxy.events.length;
    const env = baseEnv(home(), { REVITION_HOST: 'l3.revition.com', REVITION_TOKEN: PAT, HTTPS_PROXY: proxy.url, NODE_EXTRA_CA_CERTS: pki.caFile });
    const tlsMark = tls.log.length;
    const ok = await cli(['whoami', '--json'], env);
    assert.equal(ok.code, 0, ok.stderr);
    assert.equal(envelope(ok.stdout).ok, true);
    assert.ok(proxy.events.slice(before).some((e) => e.kind === 'connect' && e.target === 'l3.revition.com:443'));
    assert.ok(
      tls.log.slice(tlsMark).some((h) => h.path === '/api/v1/foundry/dev/me' && h.host.startsWith('l3.revition.com')),
      'the call crossed the proxy into the TLS server, trusted only through NODE_EXTRA_CA_CERTS'
    );
    // NO_PROXY: a loopback platform is reached directly; without NO_PROXY the same call goes through the proxy.
    const mock = await startStatusMock(() => ({ status: 200 }));
    try {
      const loop = baseEnv(home(), { REVITION_HOST: mock.host, REVITION_TOKEN: PAT, HTTP_PROXY: proxy.url, HTTPS_PROXY: proxy.url });
      const mark = proxy.events.length;
      const direct = await cli(['whoami'], { ...loop, NO_PROXY: '127.0.0.1' });
      assert.equal(direct.code, 0, `NO_PROXY=127.0.0.1: ${direct.stderr}`);
      assert.deepEqual(proxy.events.slice(mark).filter((e) => e.target.includes(mock.host)), [], 'NO_PROXY: never via the proxy');
      const mark2 = proxy.events.length;
      assert.equal((await cli(['whoami'], loop)).code, 0);
      assert.ok(proxy.events.slice(mark2).some((e) => e.target.includes(mock.host)), 'without NO_PROXY the proxy carries it');
    } finally {
      mock.close();
    }
  });

  it('[CLI-T1.1.5-AC3] Retry-After is honoured between attempts', async () => {
    const mock = await startStatusMock((n) => (n === 0 ? { status: 429, headers: { 'retry-after': '2' } } : { status: 200 }));
    try {
      const r = await cli(['whoami'], baseEnv(home(), { REVITION_HOST: mock.host, REVITION_TOKEN: PAT }));
      assert.equal(r.code, 0, r.stderr);
      const calls = mock.log.filter((h) => h.path === '/api/v1/foundry/dev/me');
      assert.ok(calls.length >= 2);
      const gap = (calls[1]?.at ?? 0) - (calls[0]?.at ?? 0);
      assert.ok(gap >= 1_900, `the retry waited ${gap} ms for Retry-After: 2`);
    } finally {
      mock.close();
    }
  });

  it('[CLI-T1.1.5-AC5] the token goes only to the profile host: the registry probe carries none', async () => {
    const before = tls.log.length;
    const env = baseEnv(home(), { REVITION_HOST: 'l3.revition.com', REVITION_TOKEN: PAT, HTTPS_PROXY: proxy.url, NODE_EXTRA_CA_CERTS: pki.caFile });
    const r = await cli(['doctor', '--json'], env);
    assert.equal(r.code === 0 || r.code === 1, true, r.stderr);
    const hits = tls.log.slice(before);
    const me = hits.filter((h) => h.path === '/api/v1/foundry/dev/me');
    const registry = hits.filter((h) => h.host.startsWith('registry.npmjs.org'));
    assert.ok(me.length > 0 && me.every((h) => (h.authorization ?? '').startsWith('Bearer rvt_')), 'the profile host got the token');
    assert.ok(registry.length > 0, 'the registry probe ran');
    assert.ok(registry.every((h) => h.authorization === undefined), 'the registry never got a token');
  });
});

describe('L3: telemetry consent in a real PTY (T1.4.2)', () => {
  it('[CLI-T1.4.2-AC2] DO_NOT_TRACK=1: no consent question, nothing written; end of input answers No, never a crash', async () => {
    const quiet = home();
    const dnt = await inPty(['config', 'path'], baseEnv(quiet, { TERM: 'xterm-256color', DO_NOT_TRACK: '1' }));
    assert.equal(dnt.code, 0, dnt.stdout);
    assert.doesNotMatch(dnt.stdout, /Help improve/u, 'DO_NOT_TRACK=1 already answered: no question');
    assert.equal(existsSync(expectedConfigFile(quiet)), false, 'nothing was written for the consent');
    // A person at the terminal presses Ctrl-D at the question: `expect` drives the real PTY and types it.
    const asked = home();
    const tcl = [
      `spawn {${NODE}} {${CLI_BIN}} config path`,
      'expect -timeout 30 "Help improve" {} timeout { exit 90 }',
      'send "\\004"',
      'expect -timeout 30 eof {} timeout { exit 91 }',
      'set r [wait]',
      'exit [lindex $r 3]',
    ].join('\n');
    const eof = await run('expect', ['-c', tcl], baseEnv(asked, { TERM: 'xterm-256color' }), undefined, 90_000, 'ignore');
    assert.match(eof.stdout, /Help improve/u, 'a first interactive run asks');
    assert.equal(eof.code, 0, `end of input is the default No, not a crash: ${eof.stdout}`);
    assert.equal(JSON.parse(readFileSync(expectedConfigFile(asked), 'utf8')).telemetry, 'off');
  });
});

describe('L3: update notice and upgrade (T1.4.1)', () => {
  async function registry(): Promise<{ url: string; close(): void }> {
    // The npm registry's two read forms the check uses (update/check.ts): the dist-tags, and the installed version's
    // own document, which carries `deprecated`.
    const s = http.createServer((req, res) => {
      const url = req.url ?? '';
      const body = url.includes('dist-tags')
        ? { latest: '9.9.9' }
        : url.endsWith('/0.1.0')
          ? { name: '@revition/cli', version: '0.1.0', deprecated: 'L3: 0.1.0 is deprecated' }
          : { name: '@revition/cli' };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    });
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    return { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, close: () => s.close() };
  }

  it('[CLI-T1.4.1-AC2] [CLI-T1.4.1-AC5] the notice (and the deprecation warning) show on a TTY, never in --json, CI or a pipe', async () => {
    const reg = await registry();
    try {
      const h = home();
      const env = {
        ...baseEnv(h, { npm_config_registry: reg.url, TERM: 'xterm-256color', DO_NOT_TRACK: '1', PAGER: 'cat' }),
        REVITION_NO_UPDATE_CHECK: undefined,
      };
      await inPty(['config', 'path'], env);
      const cache = process.platform === 'darwin' ? join(h, 'Library', 'Caches', 'revition', 'update.json') : join(h, '.cache', 'revition', 'update.json');
      for (let i = 0; i < 50 && !existsSync(cache); i++) await new Promise((r) => setTimeout(r, 200));
      assert.ok(existsSync(cache), 'the background check wrote its cache');
      const tty = await inPty(['config', 'path'], env);
      assert.match(tty.stdout, /9\.9\.9/u, 'TTY: the update notice');
      assert.match(tty.stdout, /deprecated/iu, 'TTY: the deprecation warning');
      const json = await cli(['config', 'path', '--json'], env);
      assert.doesNotMatch(`${json.stdout}${json.stderr}`, /9\.9\.9/u, '--json: no notice');
      const ci = await inPty(['config', 'path'], { ...env, CI: 'true' });
      assert.doesNotMatch(ci.stdout, /9\.9\.9/u, 'CI: no notice');
      const piped = await cli(['config', 'path'], env);
      assert.doesNotMatch(`${piped.stdout}${piped.stderr}`, /9\.9\.9/u, 'a pipe: no notice');
    } finally {
      reg.close();
    }
  });

  it('[CLI-T1.4.1-AC3] `upgrade` runs the package manager it was installed with; stdout stays one envelope', async () => {
    const sandbox = process.env['npm_config_prefix'] ?? mkdtempSync(join(tmpdir(), 'rvl3-npm-'));
    const env = baseEnv(home(), { npm_config_prefix: sandbox, NPM_CONFIG_PREFIX: sandbox, npm_config_update_notifier: 'false' });
    const r = await cli(['upgrade', '--json'], env);
    const doc = envelope(r.stdout);
    if (INSTALLED) {
      assert.equal(r.code, 0, r.stderr);
      assert.equal(doc.data?.['installer'], 'npm');
      assert.equal(doc.data?.['ran'], true);
      const lib = process.platform === 'win32' ? join(sandbox, 'node_modules') : join(sandbox, 'lib', 'node_modules');
      assert.ok(existsSync(join(lib, '@revition', 'cli', 'package.json')), 'npm really installed the CLI globally (sandbox prefix)');
    } else {
      assert.equal(doc.data?.['ran'], false, 'the source tree is not an npm install: instructions only');
    }
  });
});
