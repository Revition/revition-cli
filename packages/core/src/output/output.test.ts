import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mapPlatformError } from '../errors/map-platform-error.js';

import { hasAnsi, paint, status, useColor } from './color.js';
import { EXIT, exitCodeForStatus } from './exit-codes.js';
import { memoryIo } from './io.js';
import { animationAllowed, SPINNER_FRAMES, startProgress } from './progress.js';
import { canPrompt } from './prompt.js';
import { render } from './render.js';
import { renderTable, terminalTable, unicodeSupported } from './table.js';

describe('T1.1.3 output and UX', () => {
  it('[CLI-T1.1.3-AC2] every exit-code class is mapped (the documented table)', () => {
    const table: Array<[number, number]> = [
      [400, EXIT.usage],
      [401, EXIT.auth],
      [402, EXIT.payment],
      [403, EXIT.permission],
      [404, EXIT.notFound],
      [409, EXIT.conflict],
      [412, EXIT.conflict],
      [422, EXIT.usage],
      [426, EXIT.upgrade],
      [429, EXIT.rateLimited],
      [500, EXIT.server],
      [503, EXIT.server],
      [418, EXIT.general],
    ];
    for (const [httpStatus, code] of table) assert.equal(exitCodeForStatus(httpStatus), code, String(httpStatus));
    assert.deepEqual(
      [EXIT.ok, EXIT.general, EXIT.usage, EXIT.auth, EXIT.permission, EXIT.notFound, EXIT.conflict, EXIT.rateLimited,
        EXIT.server, EXIT.network, EXIT.upgrade, EXIT.cancelled, EXIT.payment],
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    );
    assert.equal(mapPlatformError(403, { error: { code: 'CLI_SCOPE_REQUIRED', message: 'm' } }).exitCode, EXIT.permission);
  });

  it('[CLI-T1.1.3-AC3] NO_COLOR=1 produces zero ANSI codes; colour never carries meaning alone', () => {
    assert.equal(useColor({ flag: undefined, env: { NO_COLOR: '1' }, isTTY: true }), false);
    assert.equal(useColor({ flag: 'auto', env: {}, isTTY: false }), false);
    assert.equal(useColor({ flag: 'always', env: { NO_COLOR: '1' }, isTTY: false }), true);
    assert.equal(useColor({ flag: undefined, env: {}, isTTY: true }), true);
    const io = memoryIo({ tty: true });
    const color = useColor({ flag: undefined, env: { NO_COLOR: '1' }, isTTY: true });
    render(io, {
      command: 'x',
      json: false,
      data: null,
      human: null,
      error: { code: 'E', message: 'broke', hint: 'try again', httpStatus: null, traceId: 't1', docsUrl: null },
      warnings: ['careful'],
      cliVersion: '0.1.0',
      color,
    });
    assert.equal(hasAnsi(io.stderr()), false);
    assert.match(io.stderr(), /failed broke/);
    assert.match(io.stderr(), /warn careful/);
    assert.equal(status('ok', false), 'ok');
    assert.ok(hasAnsi(paint('x', 'red', true)));
  });

  it('[CLI-T1.1.3-AC4] accessible mode (REVITION_ACCESSIBLE=1 or TERM=dumb) produces no spinner frames', () => {
    for (const env of [{ REVITION_ACCESSIBLE: '1' }, { TERM: 'dumb' }]) {
      const io = memoryIo({ tty: true });
      assert.equal(animationAllowed(env, io, false), false);
      const p = startProgress(io, env, false, 'uploading');
      p.update('still uploading');
      p.done('uploaded');
      const err = io.stderr();
      assert.ok(!SPINNER_FRAMES.some((f) => err.includes(f)), err);
      assert.match(err, /uploading\nstill uploading\nuploaded\n/);
    }
    const tty = memoryIo({ tty: true });
    startProgress(tty, {}, false, 'working');
    assert.ok(SPINNER_FRAMES.some((f) => tty.stderr().includes(f)));
  });

  it('[CLI-T1.1.3-AC5] piped output: no prompts and no animation; --json output is one document, warnings inside it', () => {
    const piped = memoryIo({ tty: false });
    assert.equal(canPrompt(piped, { json: false, noInput: false }), false);
    assert.equal(animationAllowed({}, piped, false), false);
    const p = startProgress(piped, {}, false, 'working');
    p.done('done');
    assert.equal(piped.stderr(), 'working\ndone\n');
    assert.equal(canPrompt(memoryIo({ tty: true }), { json: true, noInput: false }), false);
    assert.equal(canPrompt(memoryIo({ tty: true }), { json: false, noInput: true }), false);
    const json = memoryIo({ tty: true });
    startProgress(json, {}, true, 'hidden');
    render(json, { command: 'x', json: true, data: { a: 1 }, human: null, error: null, warnings: ['w1'], cliVersion: '0.1.0', color: true });
    assert.equal(json.stderr(), '');
    const lines = json.stdout().trim().split('\n');
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0] ?? '').warnings, ['w1']);
  });

  it('[CLI-T1.1.3-AC5] tables: --plain is tab-separated; wide tables truncate unless --wide', () => {
    const rows = [['app_1', 'A very long application name that will not fit', 'live']];
    assert.equal(
      renderTable(['id', 'name', 'status'], rows, { plain: true, wide: false, columns: 40, ascii: false }),
      'id\tname\tstatus\napp_1\tA very long application name that will not fit\tlive\n'
    );
    const narrow = renderTable(['id', 'name', 'status'], rows, { plain: false, wide: false, columns: 40, ascii: true });
    assert.ok(narrow.split('\n').every((l) => l.length <= 40), narrow);
    assert.match(narrow, /\.\.\./);
    const wide = renderTable(['id', 'name', 'status'], rows, { plain: false, wide: true, columns: 40, ascii: true });
    assert.match(wide, /will not fit/);
  });

  it('[CLI-T2.5.2-AC3] review finding 6 (Windows output): a legacy console gets ASCII rules; Unicode terminals keep them', () => {
    // Windows: only terminals known to render UTF-8 draw Unicode.
    assert.equal(unicodeSupported({}, 'win32'), false, 'legacy conhost: ASCII');
    for (const env of [{ WT_SESSION: 'x' }, { TERM_PROGRAM: 'vscode' }, { CI: 'true' }, { TERMINAL_EMULATOR: 'JetBrains-JediTerm' }, { TERM: 'xterm-256color' }, { ConEmuTask: '{cmd::Cmder}' }]) {
      assert.equal(unicodeSupported(env, 'win32'), true, JSON.stringify(env));
    }
    // POSIX: Unicode, except the Linux console and TERM=dumb (also on Windows).
    assert.equal(unicodeSupported({ TERM: 'xterm-256color' }, 'darwin'), true);
    assert.equal(unicodeSupported({ TERM: 'linux' }, 'linux'), false);
    assert.equal(unicodeSupported({ TERM: 'dumb' }, 'darwin'), false);
    assert.equal(unicodeSupported({ TERM: 'dumb', WT_SESSION: 'x' }, 'win32'), false);
    // The table a legacy Windows console gets: '-' rules and '...', never the box-drawing rule or the Unicode ellipsis.
    const rows = [['app_1', 'A very long application name that will not fit', 'live']];
    const legacy = renderTable(['id', 'name', 'status'], rows, terminalTable({ isTTY: true, columns: 40 }, {}, 'win32'));
    assert.match(legacy, /^-+ {2}-+ {2}-+$/mu);
    assert.doesNotMatch(legacy, /[─…]/u);
    const modern = renderTable(['id', 'name', 'status'], rows, terminalTable({ isTTY: true, columns: 40 }, { WT_SESSION: 'x' }, 'win32'));
    assert.match(modern, /─/u);
    // Off a terminal: plain (tab-separated), whatever the platform.
    assert.equal(terminalTable({ isTTY: false, columns: undefined }, {}, 'win32').plain, true);
  });

  it('[CLI-T2.5.2-AC3] no command hard-codes the table charset: every table takes terminalTable()', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = fileURLToPath(new URL('../../../..', import.meta.url));
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const p = join(d, n);
        if (n === 'node_modules' || n === 'dist' || n.endsWith('.test.ts')) return [];
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
      });
    const files = [join(root, 'packages/cli/src/commands'), join(root, 'plugins')].flatMap(walk);
    const tables = files.filter((f) => readFileSync(f, 'utf8').includes('renderTable('));
    assert.ok(tables.length >= 20, `commands with a table: ${tables.length}`);
    const hardCoded = files.filter((f) => /ascii:\s*(true|false)/u.test(readFileSync(f, 'utf8')));
    assert.deepEqual(hardCoded, []);
    assert.deepEqual(tables.filter((f) => !readFileSync(f, 'utf8').includes('terminalTable()')), []);
  });

  it('[CLI-T2.5.2-AC3] no command prints typographic quotes (macOS walk: "build’s" in accessible and piped output)', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = fileURLToPath(new URL('../../../..', import.meta.url));
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const p = join(d, n);
        if (n === 'node_modules' || n === 'dist' || n === 'testdata' || n.endsWith('.test.ts')) return [];
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
      });
    const files = [join(root, 'packages'), join(root, 'plugins')].flatMap(walk);
    assert.ok(files.length >= 50, `source files: ${files.length}`);
    // A legacy console and a screen reader read U+2018/2019/201C/201D badly; output strings stay ASCII quotes.
    const curly = files.filter((f) => /[‘’“”]/u.test(readFileSync(f, 'utf8')));
    assert.deepEqual(curly, []);
  });
});
