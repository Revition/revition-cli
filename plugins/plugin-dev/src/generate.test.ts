import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { COMPONENT_SCHEMAS } from '@revition/api-client';

import { localChecks } from './checks/local-checks.js';
import { readProjectDir } from './project/read-project.js';
import { dirs, ok, runCli, startMockPlatform } from './test-fixtures/mock-platform.js';

const cap = (id: string): Record<string, unknown> => ({ id, name: id, language: 'ts', entrypoint: 'run' });
const project = (caps: string[]): Record<string, string> => ({
  'revition.json': `${JSON.stringify({ summary: 'P', capabilities: caps.map(cap) }, null, 2)}\n`,
  ...Object.fromEntries(caps.flatMap((c) => [[`capabilities/${c}/run.ts`, 'export async function run(i) { return i; }\n'], [`capabilities/${c}/tests.json`, '[{"name":"t","input":1,"expect":1}]\n']])),
});

const STARTERS: Record<string, { point: string; lang: string; files: Record<string, string> }> = {
  nightly: { point: 'scheduled_job', lang: 'ts', files: { ...project(['nightly']), 'capabilities/nightly/run.ts': 'export async function run() { return { ran: true }; }\n' } },
  'nightly-py': { point: 'scheduled_job', lang: 'python', files: { 'revition.json': JSON.stringify({ summary: 'x', capabilities: [{ ...cap('nightly'), language: 'python' }] }), 'capabilities/nightly/run.py': 'def run(i):\n    return i\n', 'capabilities/nightly/tests.json': '[{"name":"t","input":1,"expect":1}]' } },
  widget: { point: 'custom_ui', lang: 'ts', files: { ...project(['widget']), 'ui/manifest.json': '{"surfaces":[{"id":"panel"}]}\n' } },
};

async function platform() {
  return startMockPlatform((method, path, _body, query) => {
    if (method === 'GET' && path === '/dev/extension-points') return ok({ extensionPoints: [{ id: 'scheduled_job' }, { id: 'custom_ui' }, { id: 'code_tool' }] });
    if (method === 'GET' && path === '/dev/starters') {
      const point = query.get('extensionPoint');
      return ok({ starters: Object.entries(STARTERS).filter(([, s]) => point === null || s.point === point).map(([id, s]) => ({ id, title: id, extensionPoint: s.point, language: s.lang })) });
    }
    const m = /^\/dev\/starters\/([^/]+)$/.exec(path);
    if (method === 'GET' && m !== null) {
      const s = STARTERS[m[1] ?? ''];
      return s === undefined ? null : ok({ id: m[1], title: m[1], extensionPoint: s.point, language: s.lang, files: s.files });
    }
    if (method === 'POST' && path === '/dev/authoring/check') return ok({ ok: true, problems: [], warnings: [], buildLogs: {}, project: null, granted: {} });
    return null;
  });
}

async function dirWith(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gen-'));
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
}

describe('T2.1.5 generate', () => {
  it('[CLI-T2.1.5-AC4] a generated test runs with `revition test` (local, offline)', async () => {
    const p = await platform();
    try {
      const dir = await dirWith(project(['hello']));
      const env = await dirs();
      const gen = await runCli(['generate', 'test', 'hello', 'echoes an empty object', '--yes'], { cwd: dir, host: p.host, env });
      assert.equal(gen.code, 0, gen.stderr);
      const t = await runCli(['test'], { cwd: dir, host: p.host, env });
      assert.equal(t.code, 0, `${t.stdout}${t.stderr}`);
      assert.match(t.stdout, /^PASS hello: echoes an empty object$/m);
      assert.match(t.stdout, /^all tests passed locally$/m);
      // `revition test` called no platform route.
      assert.deepEqual(p.log.filter((x) => x.path !== '/dev/extension-points' && !x.path.startsWith('/dev/starters')).map((x) => x.path), []);
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.1.5-AC1] each kind generates files that pass `revition build`', async () => {
    const p = await platform();
    try {
      const dir = await dirWith(project(['hello']));
      const env = await dirs();
      const steps = [
        ['generate', 'capability', 'order-sync', '--point', 'scheduled_job', '--lang', 'ts', '--yes'],
        ['generate', 'test', 'order-sync', 'handles an empty batch', '--yes'],
        ['generate', 'eval-suite', 'smoke', '--capability', 'order-sync', '--yes'],
        ['generate', 'ui-surface', '--yes'],
      ];
      for (const args of steps) {
        const r = await runCli(args, { cwd: dir, host: p.host, env });
        assert.equal(r.code, 0, `${args[1]}: ${r.stderr}`);
        assert.match(r.stdout, /build \(local checks\): ok/);
        const b = await runCli(['build'], { cwd: dir, host: p.host, env });
        assert.equal(b.code, 0, `build after ${args[1]}: ${b.stdout}${b.stderr}`);
      }
      const m = JSON.parse(readFileSync(join(dir, 'revition.json'), 'utf8')) as { capabilities: Array<{ id: string }> };
      assert.deepEqual(m.capabilities.map((c) => c.id), ['hello', 'order-sync']);
      assert.equal(readFileSync(join(dir, 'capabilities/order-sync/run.ts'), 'utf8'), STARTERS['nightly']?.files['capabilities/nightly/run.ts']);
      assert.deepEqual(JSON.parse(readFileSync(join(dir, 'capabilities/order-sync/tests.json'), 'utf8')).at(-1), { name: 'handles an empty batch', input: {}, expect: {} });
      assert.equal(readFileSync(join(dir, 'ui/manifest.json'), 'utf8'), STARTERS['widget']?.files['ui/manifest.json']);
      assert.deepEqual(localChecks(readProjectDir(dir)), []);
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.1.5-AC1] the eval suite skeleton is valid against the published EvalSuite schema (required fields, a listed dimension)', async () => {
    const p = await platform();
    try {
      const dir = await dirWith(project(['hello']));
      assert.equal((await runCli(['generate', 'eval-suite', 'smoke', '--yes'], { cwd: dir, host: p.host, env: await dirs() })).code, 0);
      const suite = JSON.parse(readFileSync(join(dir, 'evals/smoke.json'), 'utf8')) as Record<string, unknown>;
      const schema = COMPONENT_SCHEMAS['EvalSuite'] as { required: string[]; properties: { dimensions: { items: { enum: string[] } } } };
      for (const k of schema.required) assert.ok(k in suite, `required ${k}`);
      for (const d of suite['dimensions'] as string[]) assert.ok(schema.properties.dimensions.items.enum.includes(d));
      assert.deepEqual(suite['cases'], [{ id: 'case-1', input: {} }]);
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.1.5-AC1] --list reads the catalogue with no confirmation (non-interactive, no --yes), and offline from the saved copy', async () => {
    const p = await platform();
    const env = await dirs();
    try {
      const r = await runCli(['generate', '--list', '--json'], { cwd: tmpdir(), host: p.host, env });
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.deepEqual(JSON.parse(r.stdout).data.catalog.extensionPoints.map((x: { id: string }) => x.id), ['scheduled_job', 'custom_ui', 'code_tool']);
    } finally {
      p.close();
    }
    const offline = await runCli(['generate', '--list'], { cwd: tmpdir(), host: '127.0.0.1:9', env });
    assert.equal(offline.code, 0, offline.stderr);
    assert.match(offline.stdout, /\(offline: the saved list\)\nscheduled_job: nightly \(ts\), nightly-py \(python\)/);
  });

  it('[CLI-T2.1.5-AC3] an unknown kind is exit 2 with the list; an unknown point is exit 2 with the server\'s list', async () => {
    const p = await platform();
    try {
      const dir = await dirWith(project(['hello']));
      const env = await dirs();
      const kind = await runCli(['generate', 'widget-thing', '--yes'], { cwd: dir, host: p.host, env });
      assert.equal(kind.code, 2);
      assert.match(kind.stderr, /Kinds: capability, test, eval-suite, ui-surface/);
      const point = await runCli(['generate', 'capability', 'x', '--point', 'teleport', '--yes'], { cwd: dir, host: p.host, env });
      assert.equal(point.code, 2);
      assert.match(point.stderr, /The platform's: scheduled_job, custom_ui, code_tool/);
      assert.deepEqual(readdirSync(join(dir, 'capabilities')).sort(), ['hello'], 'nothing written');
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.1.5-AC5] a sixth capability or a 33rd file is refused before anything is written', async () => {
    const p = await platform();
    try {
      const env = await dirs();
      const five = await dirWith(project(['a', 'b', 'c', 'd', 'e']));
      const sixth = await runCli(['generate', 'capability', 'f', '--point', 'scheduled_job', '--yes'], { cwd: five, host: p.host, env });
      assert.equal(sixth.code, 2);
      assert.match(sixth.stderr, /already has 5 capabilities, the platform limit: nothing was written/);
      assert.equal(existsSync(join(five, 'capabilities/f')), false);
      const full = await dirWith({ ...project(['a']), ...Object.fromEntries(Array.from({ length: 29 }, (_, i) => [`evals/e${i}.json`, '{}'])) });
      const more = await runCli(['generate', 'capability', 'g', '--point', 'scheduled_job', '--yes'], { cwd: full, host: p.host, env });
      assert.equal(more.code, 2);
      assert.match(more.stderr, /That would make 34 files; the platform limit is 32: nothing was written/);
      assert.equal(JSON.parse(readFileSync(join(full, 'revition.json'), 'utf8')).capabilities.length, 1, 'the manifest is untouched');
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.1.5-AC2] an existing target file is never overwritten', async () => {
    const p = await platform();
    try {
      const dir = await dirWith({ ...project(['hello']), 'evals/smoke.json': '{"mine":true}' });
      const r = await runCli(['generate', 'eval-suite', 'smoke', '--yes'], { cwd: dir, host: p.host, env: await dirs() });
      assert.equal(r.code, 2);
      assert.equal(readFileSync(join(dir, 'evals/smoke.json'), 'utf8'), '{"mine":true}');
    } finally {
      p.close();
    }
  });
});
