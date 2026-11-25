// T3.2.1 - the machine contract: the published --json schemas are current (generated, never hand-written), a breaking
// change without its version bump fails (AC2), `revition commands --json` lists every command (AC3), and the core
// commands' --json output conforms to the published schemas (AC1).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { breakingChanges, bumpedForBreaking, schemaFileName, SCHEMA_DIR } from './generate-json-schemas.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OBJ = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: true });

describe('T3.2.1 the published --json schemas', () => {
  it('the committed schemas are exactly what the generator produces from the command types (drift gate)', () => {
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts/generate-json-schemas.mjs'), '--check'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });

  it('[CLI-T3.2.1-AC2] a breaking change (removed / retyped / nullable / no longer always present) is detected; an added field is not', () => {
    const before = OBJ({ id: { type: 'string' }, n: { type: 'number' }, tags: { type: 'array', items: OBJ({ k: { type: 'string' } }) } });
    assert.deepEqual(breakingChanges(before, OBJ({ ...before.properties, extra: { type: 'string' } }, [...before.required, 'extra'])), []);
    assert.deepEqual(breakingChanges(before, OBJ({ n: { type: 'number' }, tags: before.properties.tags })), ['/id: removed']);
    assert.deepEqual(breakingChanges(before, OBJ({ ...before.properties, n: { type: 'string' } })), ['/n: type changed']);
    assert.deepEqual(breakingChanges(before, OBJ({ ...before.properties, id: { anyOf: [{ type: 'string' }, { type: 'null' }] } })), ['/id: type changed', '/id: became nullable']);
    assert.deepEqual(breakingChanges(before, OBJ(before.properties, ['n', 'tags'])), ['/id: no longer always present']);
    assert.deepEqual(breakingChanges(before, OBJ({ ...before.properties, tags: { type: 'array', items: OBJ({}) } })), ['/tags[]/k: removed']);
  });

  it('[CLI-T3.2.1-AC2] the version a breaking change needs: the next major (the next minor before 1.0)', () => {
    assert.equal(bumpedForBreaking('0.1.0', '0.1.5'), false);
    assert.equal(bumpedForBreaking('0.1.0', '0.2.0'), true);
    assert.equal(bumpedForBreaking('1.4.0', '1.9.0'), false);
    assert.equal(bumpedForBreaking('1.4.0', '2.0.0'), true);
  });

  it('[CLI-T3.2.1-AC2] the CI gate: --semver passes on the committed schemas', () => {
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts/generate-json-schemas.mjs'), '--semver'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });

  it('[CLI-T3.2.1-AC3] commands --json lists every command of every manifest, and each schema id has its published schema', () => {
    // The core and every plugin the CLI registers (packages/cli/package.json oclif.plugins: @revition/<dir>).
    const registered = JSON.parse(readFileSync(join(ROOT, 'packages/cli/package.json'), 'utf8')).oclif.plugins;
    const dirsOf = ['packages/cli', ...registered.map((name) => `plugins/${name.replace('@revition/', '')}`)];
    const manifests = dirsOf.map((p) => JSON.parse(readFileSync(join(ROOT, p, 'oclif.manifest.json'), 'utf8')));
    const expected = manifests.flatMap((m) => Object.keys(m.commands)).sort();
    const out = execFileSync(process.execPath, [join(ROOT, 'packages/cli/bin/run'), 'commands', '--json'], { encoding: 'utf8', env: { ...process.env, REVITION_NO_UPDATE_CHECK: '1' } });
    const listed = JSON.parse(out).data.commands;
    assert.deepEqual(listed.map((c) => c.id).sort(), expected);
    for (const c of listed) {
      for (const k of ['requiredScopes', 'mutates', 'confirm', 'jsonSchemaId', 'stability']) assert.ok(k in c, `${c.id}: ${k}`);
      if (c.jsonSchemaId !== null) assert.ok(existsSync(join(SCHEMA_DIR, schemaFileName(c.id))), `${c.id}: no published schema`);
    }
  });

  it('[CLI-T3.2.1-AC1] the core commands: packages/cli/test/json-schema-conformance.test.ts passes (run here, outside the parallel package phase)', () => {
    const file = join(ROOT, 'packages/cli/test/json-schema-conformance.test.ts');
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT; // the child reports on its own stdout (TAP), not to this runner
    const r = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', file], { cwd: ROOT, encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /# pass 22\b/);
  });
});
