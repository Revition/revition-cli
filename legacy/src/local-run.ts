/**
 * Run one capability call on the developer's machine exactly as the sandbox runs it: the same program (the SDK
 * client placed before the code, the entrypoint called with the input, ONE result line tagged with a per-run nonce)
 * and the same way of reading the answer back. `local-run.test.ts` holds these byte-for-byte equal to the
 * platform's (`program-harness.ts`, `sdk-bridge.ts`).
 *
 * The child process gets NO credentials: its environment is `PATH` plus the local SDK's address and one-off token.
 * The developer's `REVITION_TOKEN`, cloud credentials and everything else in the shell never reach the code.
 * WebAssembly runs only in the cloud sandbox (`revition eval`).
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type ProgramLanguage = 'typescript' | 'python' | 'javascript';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function newNonce(): string {
  return `__REVITION_RESULT_${randomBytes(16).toString('hex')}__`;
}

/** The in-sandbox SDK client, as the platform places it before the extension's code. */
export function sdkClientPrelude(language: ProgramLanguage): string {
  if (language === 'python') {
    return [
      'import json as __rv_sdk_json, os as __rv_sdk_os, urllib.request as __rv_sdk_req',
      'def revition_sdk(call, *args):',
      "    req = __rv_sdk_req.Request(__rv_sdk_os.environ['REVITION_SDK_URL'], method='POST',",
      "        data=__rv_sdk_json.dumps({'call': call, 'args': list(args)}).encode('utf-8'),",
      "        headers={'authorization': 'Bearer ' + __rv_sdk_os.environ['REVITION_SDK_TOKEN'],",
      "                 'content-type': 'application/json'})",
      '    try:',
      '        with __rv_sdk_req.urlopen(req, timeout=20) as r:',
      '            body = __rv_sdk_json.loads(r.read().decode("utf-8"))',
      '    except __rv_sdk_req.HTTPError as e:',
      '        body = __rv_sdk_json.loads(e.read().decode("utf-8"))',
      "    if not body.get('ok'):",
      "        raise RuntimeError('SDK ' + call + ' refused: ' + str(body.get('error')))",
      "    return body.get('result')",
      '',
    ].join('\n');
  }
  return [
    'const revition = {',
    '  sdk: async (call, ...args) => {',
    '    const r = await fetch(process.env.REVITION_SDK_URL, {',
    "      method: 'POST',",
    "      headers: { authorization: 'Bearer ' + process.env.REVITION_SDK_TOKEN, 'content-type': 'application/json' },",
    '      body: JSON.stringify({ call, args }),',
    '    });',
    '    const body = await r.json();',
    '    if (!body.ok) {',
    "      throw new Error('SDK ' + call + ' refused: ' + body.error);",
    '    }',
    '    return body.result;',
    '  },',
    '};',
    '',
  ].join('\n');
}

/** The program for one call, or null when the entrypoint is not a plain identifier (never spliced into code). */
export function buildProgram(
  language: ProgramLanguage,
  source: string,
  entrypoint: string,
  input: unknown,
  nonce: string
): string | null {
  if (!IDENTIFIER.test(entrypoint)) {
    return null;
  }
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
  readonly answer:
    | { readonly ok: true; readonly output: unknown }
    | { readonly ok: false; readonly message: string }
    | null;
}

/** Split a run's stdout into log lines and the (last) tagged answer. */
export function parseRun(stdout: string, nonce: string): ParsedRun {
  const logs: string[] = [];
  let answer: ParsedRun['answer'] = null;
  for (const line of stdout.split(/\r?\n/)) {
    const at = line.indexOf(nonce);
    if (at < 0) {
      if (line.length > 0) {
        logs.push(line);
      }
      continue;
    }
    if (at > 0) {
      logs.push(line.slice(0, at));
    }
    try {
      const v = JSON.parse(line.slice(at + nonce.length)) as {
        ok?: unknown;
        output?: unknown;
        message?: unknown;
      };
      answer =
        v.ok === true
          ? { ok: true, output: v.output }
          : {
              ok: false,
              message: typeof v.message === 'string' ? v.message : 'the extension failed',
            };
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
}

export interface LocalRunOptions {
  readonly timeoutMs: number;
  /** The Python interpreter (default `python3`). */
  readonly python?: string;
}

/** The environment the code gets: nothing of the developer's shell but PATH. */
export function childEnv(sdk: { readonly url: string; readonly token: string }): NodeJS.ProcessEnv {
  return {
    PATH: process.env['PATH'] ?? '',
    REVITION_SDK_URL: sdk.url,
    REVITION_SDK_TOKEN: sdk.token,
  };
}

/** Run one call of a capability locally, against the local SDK. */
export function runLocally(
  cap: LocalCapability,
  input: unknown,
  sdk: { readonly url: string; readonly token: string },
  opts: LocalRunOptions
): Promise<LocalResult> {
  if (cap.language === 'wasm') {
    return Promise.resolve({
      ok: false,
      message: 'WebAssembly runs only in the cloud sandbox: use revition eval',
      logs: [],
    });
  }
  const language: ProgramLanguage = cap.language === 'ts' ? 'typescript' : 'python';
  const nonce = newNonce();
  const program = buildProgram(
    language,
    `${sdkClientPrelude(language)}${cap.source}`,
    cap.entrypoint,
    input,
    nonce
  );
  if (program === null) {
    return Promise.resolve({ ok: false, message: 'the entrypoint is not a plain name', logs: [] });
  }
  const dir = mkdtempSync(join(tmpdir(), 'revition-local-'));
  const file = join(dir, language === 'python' ? 'program.py' : 'program.ts');
  writeFileSync(file, program, 'utf8');
  const [cmd, args] =
    language === 'python'
      ? [opts.python ?? 'python3', [file]]
      : [process.execPath, ['--experimental-strip-types', '--no-warnings', file]];
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: childEnv(sdk), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    let finished = false;
    const done = (r: LocalResult): void => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      rmSync(dir, { recursive: true, force: true });
      resolve(r);
    };
    child.on('error', (e) =>
      done({ ok: false, message: `could not start ${cmd}: ${e.message}`, logs: [] })
    );
    child.on('close', () => {
      const parsed = parseRun(stdout, nonce);
      const logs = [...parsed.logs, ...stderr.split(/\r?\n/).filter((l) => l !== '')];
      if (timedOut) {
        done({ ok: false, message: `timed out after ${opts.timeoutMs} ms`, logs });
      } else if (parsed.answer === null) {
        done({ ok: false, message: 'the program ended without an answer', logs });
      } else if (parsed.answer.ok) {
        done({ ok: true, output: parsed.answer.output, logs });
      } else {
        done({ ok: false, message: parsed.answer.message, logs });
      }
    });
  });
}
