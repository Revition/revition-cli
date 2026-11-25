/**
 * T3.3.3 AC3 + AC4 live leg (auditor ruling #279): a REAL `revition assist --mode edit` session on a terminal. Edit mode
 * needs a TTY by design (plugins/plugin-assist/src/commands/assist.ts:28), so the session runs under a real PTY (the OS
 * Python's standard `pty` module; no new package). In accessible mode (REVITION_ACCESSIBLE=1) on a starter project with a failing test: the change
 * the assistant proposes is applied after `y`, the file is read changed, `/undo` restores it byte for byte (AC3), and
 * no spinner frame is ever drawn (AC4). The screen-reader pass is the person part (UA13).
 *
 *   REVITION_E2E_HOST / REVITION_E2E_TOKEN   the platform host and a PAT of the E2E developer (never printed)    required
 *   REVITION_E2E_PAID_OK=1                   run the paid session (one quoted session, budget below)            required
 *   REVITION_E2E_ASSIST_BUDGET               the session budget cap in credits (default 20; enforced by the platform)
 *   REVITION_E2E_REHEARSE_TTY=1              $0 rehearsal: an unreachable host; proves only the PTY hops (edit mode
 *                                            accepted on the terminal, the session starts) up to the first turn
 *   REVITION_CLI_BIN                         the CLI entry (default packages/cli/bin/run)
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const E = process.env;
const REHEARSE = E['REVITION_E2E_REHEARSE_TTY'] === '1';
const HOST = REHEARSE ? '127.0.0.1:9' : (E['REVITION_E2E_HOST'] ?? '');
const TOKEN = REHEARSE ? 'rvt_rehearsal_tty_only' : (E['REVITION_E2E_TOKEN'] ?? '');
const BUDGET = E['REVITION_E2E_ASSIST_BUDGET'] ?? '20';
const BIN = E['REVITION_CLI_BIN'] ?? fileURLToPath(new URL('../packages/cli/bin/run', import.meta.url));
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SKIP = REHEARSE ? false : HOST === '' || TOKEN === '' || E['REVITION_E2E_PAID_OK'] !== '1' ? 'set REVITION_E2E_HOST, REVITION_E2E_TOKEN and REVITION_E2E_PAID_OK=1 (or REVITION_E2E_REHEARSE_TTY=1)' : false;
const ORIGINAL = "export const greet = (name) => 'helo ' + name;\n";

function starter(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'assist-pty-')));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'starter', private: true, type: 'module', scripts: { test: 'node greet.check.mjs' } }));
  writeFileSync(join(root, 'src', 'greet.js'), ORIGINAL);
  writeFileSync(join(root, 'greet.check.mjs'), "import assert from 'node:assert/strict';\nimport { greet } from './src/greet.js';\nassert.equal(greet('ada'), 'hello ada');\nconsole.log('1 test passed');\n");
  return root;
}

/**
 * The command under a real pseudo-terminal. The OS `script` (ruling #279) refuses a piped stdin on macOS ("tcgetattr/
 * ioctl: Operation not supported on socket", rehearsal 2026-11-24), so the PTY is the OS Python's own `pty` module (in
 * the standard library: no new package): the CLI sees a TTY on stdin/stdout/stderr, and this driver types through it.
 */
function underPty(args: readonly string[]): [string, string[]] {
  return ['python3', ['-I', '-c', 'import pty, sys; sys.exit(pty.spawn(sys.argv[1:]) >> 8)', process.execPath, BIN, ...args]];
}

describe('assist on a real terminal (PTY)', { skip: SKIP }, () => {
  it('[CLI-T3.3.3-AC3] [CLI-T3.3.3-AC4] edit mode on a PTY: y applies the change, /undo restores the file; accessible mode draws no spinner', { timeout: 600_000 }, async () => {
    const root = starter();
    const file = join(root, 'src', 'greet.js');
    const [bin, argv] = underPty(['assist', 'make the starter test pass: fix src/greet.js', '--mode', 'edit', '--budget', BUDGET]);
    const child = spawn(bin, argv, {
      cwd: root,
      env: { ...E, REVITION_HOST: HOST, REVITION_TOKEN: TOKEN, REVITION_ACCESSIBLE: '1', REVITION_NO_UPDATE_CHECK: '1', REVITION_TELEMETRY: '0', NO_COLOR: '1', TERM: 'xterm-256color', XDG_CONFIG_HOME: join(root, '.c'), XDG_STATE_HOME: join(root, '.s'), XDG_CACHE_HOME: join(root, '.k'), APPDATA: join(root, '.a'), LOCALAPPDATA: join(root, '.l') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let applied = false;
    let changedSeen: string | null = null;
    let undoSent = false;
    let exitSent = false;
    let seenUpTo = 0;
    const send = (line: string): void => void child.stdin.write(`${line}\r`);
    const onData = (d: Buffer): void => {
      out += d.toString();
      const fresh = out.slice(seenUpTo);
      if (/Apply this change to [^\n]*\?/u.test(fresh) && !applied) {
        seenUpTo = out.length;
        applied = true;
        send('y');
      } else if (/Run `[^`]*`\?/u.test(fresh)) {
        seenUpTo = out.length;
        send('y');
      } else if (/(^|\n)> $/u.test(fresh)) {
        seenUpTo = out.length;
        if (applied && !undoSent) {
          changedSeen = readFileSync(file, 'utf8');
          undoSent = true;
          send('/undo');
        } else if (!exitSent) {
          exitSent = true;
          send('/exit');
        }
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const code = await new Promise<number | null>((r) => child.on('close', r));
    const transcript = out.split(TOKEN).join('[TOKEN]');
    assert.doesNotMatch(transcript, /needs a terminal|requires a terminal/iu, 'edit mode was accepted on the PTY');
    if (REHEARSE) {
      // $0: the PTY hops pass (edit mode accepted, the session started); the first turn is held (unreachable host).
      assert.notEqual(code, null);
      assert.doesNotMatch(transcript, /tcgetattr|Traceback|not a tty/iu, 'the PTY itself worked');
      assert.match(transcript, /127\.0\.0\.1:9|reach|connect|network/iu, 'the CLI started the session and stopped at the first turn (held: unreachable host)');
      console.log(`ASSIST-PTY rehearsal exit=${String(code)} bytes=${transcript.length} out=${JSON.stringify(transcript.slice(0, 400))}`);
      return;
    }
    assert.equal(applied, true, `a change was proposed and applied after y:\n${transcript.slice(-1500)}`);
    assert.notEqual(changedSeen, ORIGINAL, 'the applied change was on disk before /undo');
    assert.equal(readFileSync(file, 'utf8'), ORIGINAL, 'AC3: /undo restored the file byte for byte');
    for (const f of SPINNER_FRAMES) assert.ok(!transcript.includes(f), `AC4: frame ${f} drawn in accessible mode`);
    console.log(`ASSIST-PTY exit=${String(code)} applied=true undo=restored spinner-frames=0`);
  });
});
