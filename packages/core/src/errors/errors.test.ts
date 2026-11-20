import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { executeCommand } from '../command/base-command.js';
import { DebugLog } from '../log/debug-log.js';
import { memoryIo } from '../output/io.js';
import { REDACTED } from '../redact/patterns.js';
import { LineRedactor, redact, redactBody, redactValue } from '../redact/redact.js';

import { RevitionCliError } from './cli-error.js';
import { mapPlatformError } from './map-platform-error.js';

/** One of each secret shape the CLI can hold (all fake). */
const SECRETS = {
  pat: 'rvt_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0',
  session: 'rvs_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2H1g0',
  appKey: 'rdk_0123456789abcdef_' + 'abcdefghijKLMNOPQRST_-uvwx',
  jwt: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdXRoMHx4In0.c2lnbmF0dXJlc2lnbmF0dXJl',
  refresh: 'refresh_token=8xLOxBtZp8',
  bearer: 'Bearer opaque-access-value-123',
  header: 'authorization: Basic dXNlcjpwYXNz',
};
const LEAKS = (text: string): string[] =>
  Object.entries(SECRETS)
    .filter(([, s]) => {
      const tail = s.slice(-10);
      return text.includes(tail);
    })
    .map(([k]) => k);

describe('T1.1.4 errors, debug log, redaction', () => {
  it('[CLI-T1.1.4-AC1] the secrets-leak suite: every sink shows [REDACTED], never the secret', async () => {
    const all = Object.values(SECRETS).join(' | ');
    // 1. an error (human render) and 2. a warning, through the real pipeline
    const io = memoryIo();
    const meta = { id: 'leak:test', summary: 's', examples: ['e'], requiredScopes: [], mutates: false, confirm: 'none', jsonSchemaId: null, stability: 'stable' } as const;
    const base = {
      meta,
      flags: { json: false, noInput: true, yes: false, experimental: false, profile: undefined, debug: false, color: 'never' as const },
      args: {},
      commandFlags: {},
      env: {},
      cliVersion: '0.1.0',
      services: { loadProfile: async () => ({ name: 'default' }), resolveAuth: async () => null, featureEnabled: async () => false },
      human: null,
      confirmTarget: () => null,
      writeHuman: async () => undefined,
    };
    await executeCommand({
      ...base,
      io,
      run2: async (ctx) => {
        ctx.warn(`warning carries ${all}`);
        throw new RevitionCliError({ code: 'X', message: `error carries ${all}`, hint: all });
      },
    });
    assert.deepEqual(LEAKS(io.stderr()), [], io.stderr());
    assert.ok(io.stderr().includes(REDACTED));
    // 3. --json (warnings + error inside the envelope)
    const jsonIo = memoryIo();
    await executeCommand({
      ...base,
      flags: { ...base.flags, json: true },
      io: jsonIo,
      run2: async (ctx) => {
        ctx.warn(all);
        throw new RevitionCliError({ code: 'X', message: all });
      },
    });
    assert.deepEqual(LEAKS(jsonIo.stdout()), [], jsonIo.stdout());
    JSON.parse(jsonIo.stdout());
    // 4. the debug log file (an unexpected error's stack lands only there, redacted)
    const dir = await mkdtemp(join(tmpdir(), 'revlog-'));
    const log = new DebugLog(dir, {});
    await executeCommand({
      ...base,
      io: memoryIo(),
      debugLog: log,
      run2: async () => {
        throw new Error(`boom ${all}`);
      },
    });
    const logText = await readFile(log.file, 'utf8');
    assert.match(logText, /unexpected trace=/);
    assert.deepEqual(LEAKS(logText), [], logText);
    // 5. a telemetry-shaped payload goes through redactValue (the telemetry sink, T1.4.2, uses it)
    assert.deepEqual(LEAKS(JSON.stringify(redactValue({ event: 'cmd', detail: all }))), []);
    // A secret split across two writes is still caught (whole-line buffers).
    let sink = '';
    const r = new LineRedactor((s) => (sink += s));
    r.write(`token ${SECRETS.pat.slice(0, 20)}`);
    r.write(`${SECRETS.pat.slice(20)} end\n`);
    assert.deepEqual(LEAKS(sink), []);
    assert.equal(redact(SECRETS.jwt), REDACTED);
  });

  it('[CLI-T1.1.4-AC1] a huge output line is redacted whole and never shortened (a --json document stays valid); a logged body is truncated', () => {
    const doc = JSON.stringify({ items: Array.from({ length: 2000 }, (_v, i) => ({ id: `item-${i}`, note: 'x'.repeat(80) })), tail: SECRETS.pat });
    assert.ok(doc.length > 200_000);
    let sink = '';
    const r = new LineRedactor((s) => (sink += s));
    r.write(`${doc}\n`);
    assert.deepEqual(LEAKS(sink), []);
    const parsed = JSON.parse(sink) as { items: unknown[]; tail: string };
    assert.equal(parsed.items.length, 2000);
    assert.equal(parsed.tail, REDACTED);
    const body = redactBody(`${'y'.repeat(70_000)} ${SECRETS.pat}`);
    assert.ok(body.length < 70_000 && body.endsWith('...[truncated]'));
    assert.deepEqual(LEAKS(redactBody(`${SECRETS.pat} ${'y'.repeat(70_000)}`)), []);
  });

  it('[CLI-T1.1.4-AC2] the platform error mapping keeps trace_id and maps the status to an exit code', () => {
    const e = mapPlatformError(409, {
      error: { code: 'CONFLICT', message: 'Version moved.', timestamp: '2026-11-18T00:00:00Z', trace_id: 'trace-abc' },
    });
    assert.equal(e.error.traceId, 'trace-abc');
    assert.equal(e.error.code, 'CONFLICT');
    assert.equal(e.error.httpStatus, 409);
    assert.equal(e.exitCode, 6);
    const bare = mapPlatformError(502, 'gateway html', { 'x-request-id': 'req-9' });
    assert.equal(bare.exitCode, 8);
    assert.equal(bare.error.traceId, 'req-9');
    assert.equal(bare.error.code, 'HTTP_502');
    assert.match(mapPlatformError(401, {}).error.hint ?? '', /revition login/);
  });

  it('[CLI-T1.1.4-AC3] REVITION_DEBUG_BODIES=1 on /oauth/* or token routes logs no body; elsewhere bodies are redacted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'revlog-'));
    const log = new DebugLog(dir, { REVITION_DEBUG_BODIES: '1' });
    for (const path of ['/oauth/token', '/dev/tokens', '/dev/cli/sessions', '/dev/cli/sessions/abc/reauth', '/oauth/device/code']) {
      await log.http({ method: 'POST', path, status: 200, latencyMs: 12, traceId: 't', requestBody: '{"a":"REQ-BODY"}', responseBody: '{"b":"RESP-BODY"}' });
    }
    await log.http({ method: 'GET', path: '/dev/apps', status: 200, latencyMs: 9, traceId: 't2', responseBody: `{"key":"${SECRETS.pat}","name":"VISIBLE"}` });
    const text = await readFile(log.file, 'utf8');
    assert.doesNotMatch(text, /REQ-BODY|RESP-BODY/);
    assert.match(text, /HTTP POST \/oauth\/token -> 200 12ms trace=t/);
    assert.match(text, /VISIBLE/);
    assert.deepEqual(LEAKS(text), []);
    const noBodies = new DebugLog(await mkdtemp(join(tmpdir(), 'revlog-')), {});
    await noBodies.http({ method: 'GET', path: '/dev/apps', status: 200, latencyMs: 1, traceId: null, responseBody: 'BODY' });
    assert.doesNotMatch(await readFile(noBodies.file, 'utf8'), /BODY/);
  });

  it('[CLI-T1.1.4-AC3] the debug log is mode 0600 and older than 7 days is deleted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'revlog-'));
    const old = join(dir, 'debug-2020-01-01.log');
    await writeFile(old, 'old');
    const past = new Date('2020-01-01T00:00:00Z');
    await utimes(old, past, past);
    const log = new DebugLog(dir, {});
    await log.line('hello');
    assert.deepEqual((await readdir(dir)).filter((f) => f.startsWith('debug-2020')), []);
    if (process.platform !== 'win32') assert.equal((await stat(log.file)).mode & 0o777, 0o600);
  });
});
