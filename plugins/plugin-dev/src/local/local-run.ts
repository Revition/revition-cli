/**
 * T2.1.3 (REVITION-CLI-PLAN.md:2021-2024, ported from legacy/src/local-run.ts): run one capability call on the
 * developer's machine exactly as the legacy `test` did (the same program: SDK client before the code, the entrypoint
 * called with the input, ONE result line tagged with a per-run nonce, read back the same way), except that:
 *   - the SDK client is the fixture SDK (fixture-sdk.ts): no local SDK server, no network, no credential;
 *   - the network is BLOCKED in the child (AC2 :2033 "a network attempt during `test` fails the run with a message"):
 *     a TypeScript program runs with a preload that refuses sockets, DNS and fetch; a Python program starts with the
 *     same refusal on its socket module.
 * The child's environment is PATH only: nothing of the developer's shell (tokens, cloud credentials) reaches the code.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fixtureSdkPrelude, type FixtureSdkSpec } from './fixture-sdk.js';

export type ProgramLanguage = 'typescript' | 'python';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The marker of a blocked network attempt, in every refusal the child raises. */
export const NETWORK_BLOCKED = 'REVITION_TEST_NETWORK_BLOCKED';
const BLOCK_MESSAGE = 'revition test runs offline: answer SDK calls from fixtures.json';

export function newNonce(): string {
  return `__REVITION_RESULT_${randomBytes(16).toString('hex')}__`;
}

/** The preload for a TypeScript program: every way out of the machine refuses, with the marker and the fix. */
export const NODE_NETWORK_BLOCK = [
  "import net from 'node:net';",
  "import tls from 'node:tls';",
  "import dns from 'node:dns';",
  `const blocked = (what) => { throw new Error('${NETWORK_BLOCKED}: ' + what + ' (${BLOCK_MESSAGE})'); };`,
  "net.Socket.prototype.connect = function () { blocked('a network connection'); };",
  "net.connect = net.createConnection = () => blocked('a network connection');",
  "tls.connect = () => blocked('a TLS connection');",
  "dns.lookup = () => blocked('a DNS lookup');",
  "dns.promises.lookup = async () => blocked('a DNS lookup');",
  "globalThis.fetch = async (u) => blocked('fetch ' + String(u));",
  '',
].join('\n');

/** The same refusal at the top of a Python program. */
export const PYTHON_NETWORK_BLOCK = [
  'import socket as __rv_net',
  'def __rv_blocked(*_a, **_k):',
  `    raise OSError('${NETWORK_BLOCKED}: a network connection (${BLOCK_MESSAGE})')`,
  '__rv_net.socket.connect = __rv_blocked',
  '__rv_net.socket.connect_ex = __rv_blocked',
  '__rv_net.create_connection = __rv_blocked',
  '__rv_net.getaddrinfo = __rv_blocked',
  '',
].join('\n');

/** The program for one call, or null when the entrypoint is not a plain identifier (never spliced into code). */
export function buildProgram(
  language: ProgramLanguage,
  source: string,
  entrypoint: string,
  input: unknown,
  nonce: string
): string | null {
  if (!IDENTIFIER.test(entrypoint)) return null;
  const json = JSON.stringify(input ?? null);
  if (language === 'python') {
    const b64 = Buffer.from(json, 'utf8').toString('base64');
    return [
      source,
      'import json as __rv_json, base64 as __rv_b64',
      'try:',
      `    __rv_out = ${entrypoint}(__rv_json.loads(__rv_b64.b64decode('${b64}').decode('utf-8')))`,
      `    print('${nonce}' + __rv_json.dumps({'ok': True, 'output': __rv_out}))`,
      'except Exception as __rv_e:',
      `    print('${nonce}' + __rv_json.dumps({'ok': False, 'message': str(__rv_e)}))`,
      '',
    ].join('\n');
  }
  return [
    source,
    ';(async () => {',
    '  try {',
    `    const __rvOut = await ${entrypoint}(JSON.parse(${JSON.stringify(json)}));`,
    `    console.log('${nonce}' + JSON.stringify({ ok: true, output: __rvOut === undefined ? null : __rvOut }));`,
    '  } catch (e) {',
    `    console.log('${nonce}' + JSON.stringify({ ok: false, message: String(e instanceof Error ? e.message : e) }));`,
    '  }',
    '})();',
    '',
  ].join('\n');
}

export interface ParsedRun {
  readonly logs: readonly string[];
  readonly answer: { readonly ok: true; readonly output: unknown } | { readonly ok: false; readonly message: string } | null;
}

/** Split a run's stdout into log lines and the (last) tagged answer. */
export function parseRun(stdout: string, nonce: string): ParsedRun {
  const logs: string[] = [];
  let answer: ParsedRun['answer'] = null;
  for (const line of stdout.split(/\r?\n/)) {
    const at = line.indexOf(nonce);
    if (at < 0) {
      if (line.length > 0) logs.push(line);
      continue;
    }
    if (at > 0) logs.push(line.slice(0, at));
    try {
      const v = JSON.parse(line.slice(at + nonce.length)) as { ok?: unknown; output?: unknown; message?: unknown };
      answer =
        v.ok === true
          ? { ok: true, output: v.output }
          : { ok: false, message: typeof v.message === 'string' ? v.message : 'the extension failed' };
    } catch {
      answer = { ok: false, message: 'the extension returned an unreadable result' };
    }
  }
  return { logs, answer };
}

export interface LocalCapability {
  readonly language: 'ts' | 'python' | 'wasm';
  readonly source: string;
  readonly entrypoint: string;
}

export interface LocalResult {
  readonly ok: boolean;
  readonly output?: unknown;
  readonly message?: string;
  readonly logs: readonly string[];
  /** The run tried to reach the network (and was refused). */
  readonly networkAttempt: boolean;
}

export interface LocalRunOptions {
  readonly timeoutMs: number;
  /** The Python interpreter (default `python3`). */
  readonly python?: string;
}

/** The environment the code gets: nothing of the developer's shell but PATH. */
export function childEnv(): NodeJS.ProcessEnv {
  return { PATH: process.env['PATH'] ?? '' };
}

/** Run one call of a capability locally, against the fixture SDK, with the network blocked. */
export function runLocally(cap: LocalCapability, input: unknown, sdk: FixtureSdkSpec, opts: LocalRunOptions): Promise<LocalResult> {
  if (cap.language === 'wasm') {
    return Promise.resolve({ ok: false, message: 'WebAssembly runs only in the cloud sandbox: use revition eval', logs: [], networkAttempt: false });
  }
  const language: ProgramLanguage = cap.language === 'ts' ? 'typescript' : 'python';
  const nonce = newNonce();
  const head = language === 'python' ? `${PYTHON_NETWORK_BLOCK}${fixtureSdkPrelude(language, sdk)}` : fixtureSdkPrelude(language, sdk);
  const program = buildProgram(language, `${head}${cap.source}`, cap.entrypoint, input, nonce);
  if (program === null) return Promise.resolve({ ok: false, message: 'the entrypoint is not a plain name', logs: [], networkAttempt: false });
  const dir = mkdtempSync(join(tmpdir(), 'revition-test-'));
  const file = join(dir, language === 'python' ? 'program.py' : 'program.ts');
  writeFileSync(file, program, 'utf8');
  const preload = join(dir, 'no-network.mjs');
  writeFileSync(preload, NODE_NETWORK_BLOCK, 'utf8');
  const [cmd, args] =
    language === 'python'
      ? [opts.python ?? 'python3', [file]]
      : [process.execPath, ['--experimental-strip-types', '--no-warnings', '--import', preload, file]];
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, { env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    let finished = false;
    const done = (r: Omit<LocalResult, 'networkAttempt'>): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      rmSync(dir, { recursive: true, force: true });
      const text = `${r.message ?? ''}\n${r.logs.join('\n')}`;
      resolveRun({ ...r, networkAttempt: text.includes(NETWORK_BLOCKED) });
    };
    child.on('error', (e) => done({ ok: false, message: `could not start ${cmd}: ${e.message}`, logs: [] }));
    child.on('close', () => {
      const parsed = parseRun(stdout, nonce);
      const logs = [...parsed.logs, ...stderr.split(/\r?\n/).filter((l) => l !== '')];
      if (timedOut) done({ ok: false, message: `timed out after ${opts.timeoutMs} ms`, logs });
      else if (parsed.answer === null) done({ ok: false, message: 'the program ended without an answer', logs });
      else if (parsed.answer.ok) done({ ok: true, output: parsed.answer.output, logs });
      else done({ ok: false, message: parsed.answer.message, logs });
    });
  });
}
