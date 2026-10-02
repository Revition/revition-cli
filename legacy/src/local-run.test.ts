/**
 * T2.11.5 — the local run is the sandbox's program, byte for byte, and gets no credentials.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import type { SdkReference } from './client';
import { localDevPorts, serveLocalSdk, type LocalCall } from './local-dev';
import { buildProgram, childEnv, parseRun, runLocally, sdkClientPrelude } from './local-run';

const API = join(__dirname, '../../../apps/api/src/services/foundry');
const harness = require(join(API, 'runtime/adapters/program-harness')) as {
  buildProgram: typeof buildProgram;
  parseRun: typeof parseRun;
};
const bridge = require(join(API, 'runtime/code/sdk-bridge')) as {
  sdkClientPrelude: typeof sdkClientPrelude;
};
const REF = (
  require(join(API, 'devportal/docs/sdk-reference.generated')) as { SDK_REFERENCE: SdkReference }
).SDK_REFERENCE;
const STARTERS = (
  require(join(API, 'devportal/docs/docs-catalog')) as {
    STARTER_TEMPLATES: readonly {
      id: string;
      upload: { language: 'ts' | 'python'; source: string; entrypoint: string };
      tests: readonly { input: unknown; expect: unknown }[];
    }[];
  }
).STARTER_TEMPLATES;

const hasPython = (): boolean => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

describe('the program is the sandbox’s own', () => {
  it('prelude, program and answer parsing are byte-identical to the platform’s', () => {
    for (const lang of ['typescript', 'python', 'javascript'] as const) {
      expect(sdkClientPrelude(lang)).toBe(bridge.sdkClientPrelude(lang));
      const args = [lang, 'def main(i): pass', 'main', { a: [1, 'x'] }, '__N__'] as const;
      expect(buildProgram(...args)).toBe(harness.buildProgram(...args));
    }
    expect(buildProgram('python', 's', 'main()', {}, 'n')).toBeNull();
    const out = 'log one\n__N__{"ok":true,"output":{"x":1}}\nforged __N__{"ok":false}\n';
    expect(parseRun(out, '__N__')).toEqual(harness.parseRun(out, '__N__'));
  });
});

describe('local runs', () => {
  const noSdk = { url: 'http://127.0.0.1:9/sdk', token: 't' };

  it('every TypeScript starter passes its own tests locally', async () => {
    const calls: LocalCall[] = [];
    const sdk = await serveLocalSdk(localDevPorts(REF, [], { 'observability.log': null }, calls));
    try {
      for (const s of STARTERS.filter((x) => x.upload.language === 'ts')) {
        for (const t of s.tests) {
          const r = await runLocally(s.upload, t.input, sdk, { timeoutMs: 20_000 });
          expect([s.id, r]).toMatchObject([s.id, { ok: true, output: t.expect }]);
        }
      }
    } finally {
      await sdk.close();
    }
    // The webhook starter logged through the SDK: answered locally, recorded.
    expect(calls.map((c) => [c.call, c.answer.ok])).toEqual([['observability.log', true]]);
  }, 60_000);

  (hasPython() ? it : it.skip)(
    'every Python starter passes its own tests locally',
    async () => {
      for (const s of STARTERS.filter((x) => x.upload.language === 'python')) {
        for (const t of s.tests) {
          expect(await runLocally(s.upload, t.input, noSdk, { timeoutMs: 20_000 })).toMatchObject({
            ok: true,
            output: t.expect,
          });
        }
      }
    },
    60_000
  );

  it('a refused SDK call fails the run with the reason; the code sees the refusal, not data', async () => {
    const sdk = await serveLocalSdk(localDevPorts(REF, [], {}));
    try {
      const r = await runLocally(
        {
          language: 'ts',
          entrypoint: 'main',
          source: [
            'export async function main(): Promise<unknown> {',
            "  return revition.sdk('data.read', 'shopify', 'q', null);",
            '}',
            '',
          ].join('\n'),
        },
        {},
        sdk,
        { timeoutMs: 20_000 }
      );
      expect(r).toMatchObject({ ok: false, message: 'SDK data.read refused: AGENT_FORBIDDEN' });
    } finally {
      await sdk.close();
    }
  }, 30_000);

  it('the code gets no credentials: PATH and the local SDK only', async () => {
    process.env['REVITION_TOKEN'] = 'rt_secret';
    process.env['AWS_SECRET_ACCESS_KEY'] = 'aws_secret';
    try {
      const r = await runLocally(
        {
          language: 'ts',
          entrypoint: 'main',
          source: 'export function main(): string[] { return Object.keys(process.env).sort(); }\n',
        },
        {},
        noSdk,
        { timeoutMs: 20_000 }
      );
      expect(r).toMatchObject({ ok: true });
      const keys = r.output as string[];
      expect(keys).not.toContain('REVITION_TOKEN');
      expect(keys).not.toContain('AWS_SECRET_ACCESS_KEY');
      expect(keys.filter((k) => k.startsWith('REVITION'))).toEqual([
        'REVITION_SDK_TOKEN',
        'REVITION_SDK_URL',
      ]);
      expect(Object.keys(childEnv(noSdk)).sort()).toEqual([
        'PATH',
        'REVITION_SDK_TOKEN',
        'REVITION_SDK_URL',
      ]);
    } finally {
      delete process.env['REVITION_TOKEN'];
      delete process.env['AWS_SECRET_ACCESS_KEY'];
    }
  }, 30_000);

  it('a thrown error, a hang, a missing answer, wasm, a bad entrypoint, a missing interpreter', async () => {
    const run = (source: string, timeoutMs = 20_000) =>
      runLocally({ language: 'ts', entrypoint: 'main', source }, {}, noSdk, { timeoutMs });
    expect(await run("export function main(): never { throw new Error('boom'); }\n")).toMatchObject(
      {
        ok: false,
        message: 'boom',
      }
    );
    expect(
      await run(
        'export function main(): Promise<never> { return new Promise(() => { setInterval(() => {}, 1000); }); }\n',
        1500
      )
    ).toMatchObject({
      ok: false,
      message: 'timed out after 1500 ms',
    });
    expect(await run('export function main(): void { process.exit(0); }\n')).toMatchObject({
      ok: false,
      message: 'the program ended without an answer',
    });
    expect(
      await runLocally({ language: 'wasm', entrypoint: 'main', source: 'AA==' }, {}, noSdk, {
        timeoutMs: 1000,
      })
    ).toEqual({
      ok: false,
      message: 'WebAssembly runs only in the cloud sandbox: use revition eval',
      logs: [],
    });
    expect(
      await runLocally({ language: 'ts', entrypoint: 'main()', source: 'x' }, {}, noSdk, {
        timeoutMs: 1000,
      })
    ).toMatchObject({
      ok: false,
      message: 'the entrypoint is not a plain name',
    });
    expect(
      await runLocally(
        { language: 'python', entrypoint: 'main', source: 'def main(i): pass' },
        {},
        noSdk,
        {
          timeoutMs: 1000,
          python: 'no-such-python-binary',
        }
      )
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining('could not start no-such-python-binary'),
    });
  }, 60_000);
});
