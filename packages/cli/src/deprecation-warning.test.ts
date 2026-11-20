import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { deprecationNotice, metaProblems } from '@revition/cli-core';

import { FIXTURE_RUN, runCli } from './test-fixtures/spawn-cli.js';

async function dirs(): Promise<Record<string, string>> {
  const root = await mkdtemp(join(tmpdir(), 'revdep-'));
  return { XDG_CONFIG_HOME: join(root, 'config'), XDG_STATE_HOME: join(root, 'state'), XDG_CACHE_HOME: join(root, 'cache') };
}

const BASE = {
  id: 'fixture:old',
  summary: 'x',
  examples: ['revition fixture old'],
  requiredScopes: [],
  mutates: false,
  confirm: 'none',
  jsonSchemaId: null,
  stability: 'stable',
};

describe('T1.5.1 deprecation in practice', () => {
  it('[CLI-T1.5.1-AC3] a deprecated command warns on stderr and still works (exit 0, its output unchanged)', async () => {
    const r = await runCli(FIXTURE_RUN, ['fixture', 'old'], { env: await dirs() });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, 'works\n');
    assert.match(r.stderr, /`fixture old` is deprecated since 0\.2\.0 and will be removed in 1\.0\.0\. Use `fixture hello` instead\./);
  });

  it('[CLI-T1.5.1-AC3] under --json the warning is in warnings[] and stdout stays one JSON document', async () => {
    const r = await runCli(FIXTURE_RUN, ['fixture', 'old', '--json'], { env: await dirs() });
    assert.equal(r.code, 0);
    const doc = JSON.parse(r.stdout) as { data: unknown; warnings: string[] };
    assert.deepEqual(doc.data, { still: 'works' });
    assert.equal(doc.warnings.filter((w) => w.includes('is deprecated since 0.2.0')).length, 1);
    assert.doesNotMatch(r.stderr, /deprecated/);
  });

  it('[CLI-T1.5.1-AC3] the policy is enforced on meta: removal only in a later major; a stable command has no notice', () => {
    assert.deepEqual(metaProblems({ ...BASE, deprecated: { since: '1.4.0', removeIn: '2.0.0', replacement: null } }), []);
    assert.deepEqual(metaProblems({ ...BASE, deprecated: { since: '1.4.0', removeIn: '1.9.0', replacement: null } }), [
      'deprecated: removeIn must be a later major than since',
    ]);
    assert.deepEqual(metaProblems({ ...BASE, deprecated: { since: 'soon', removeIn: '2.0.0', replacement: null } }), [
      'deprecated: since and removeIn must be x.y.z versions',
    ]);
    assert.equal(deprecationNotice({ id: 'fixture:hello' }), null);
  });
});
