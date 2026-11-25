import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { guardPath, PolicyRefusal } from './path-guard.js';
import { DEFAULT_DENY_READ, effectivePolicy, parsePolicyFile } from './policy.js';

/** T3.3.2 AC2 - the deny list wins: `.env` and the other secret-bearing files are refused even when asked for. */
function project(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'deny-')));
  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, 'node_modules', '.cache'), { recursive: true });
  for (const f of ['.env', '.env.local', 'config/.env.production', 'server.pem', 'config/id_ed25519', '.git/config', 'node_modules/.cache/x', 'src.ts']) {
    writeFileSync(join(root, f), 'x\n');
  }
  return root;
}

const denied = (fn: () => unknown): void => {
  assert.throws(fn, (e: unknown) => e instanceof PolicyRefusal && /deny list/.test(e.message));
};

describe('T3.3.2 the deny list', () => {
  it('[CLI-T3.3.2-AC2] .env (and .env.*, keys, .git/config, node_modules/.cache) is refused even when the model asks', () => {
    const root = project();
    const p = effectivePolicy(root);
    for (const f of ['.env', '.env.local', 'config/.env.production', 'server.pem', 'config/id_ed25519', '.git/config', 'node_modules/.cache/x']) {
      denied(() => guardPath(p, f, 'read'));
      denied(() => guardPath(p, f, 'write'));
    }
    assert.equal(guardPath(p, 'src.ts', 'read').rel, 'src.ts');
  });

  it('[CLI-T3.3.2-AC2] deny wins over allow, over a project file, and over a link with an innocent name', () => {
    const root = project();
    // A project config that tries to allow .env and to drop the default deny list: the defaults still apply.
    const projectFile = parsePolicyFile(JSON.stringify({ allowRead: ['**'], denyRead: [] }), 'assist.json');
    const p = effectivePolicy(root, {}, projectFile);
    for (const d of DEFAULT_DENY_READ) assert.ok(p.denyRead.includes(d), d);
    denied(() => guardPath(p, '.env', 'read'));
    symlinkSync(join(root, '.env'), join(root, 'notes.txt'));
    denied(() => guardPath(p, 'notes.txt', 'read'));
    // allowRead narrows: outside it is refused too.
    const narrow = effectivePolicy(root, {}, parsePolicyFile(JSON.stringify({ allowRead: ['src/**'] }), 'assist.json'));
    assert.throws(() => guardPath(narrow, 'src.ts', 'read'), /allow list/);
  });

  it('a policy file with an unknown field or a bad mode is refused (exit 2)', () => {
    assert.throws(() => parsePolicyFile('{"writeMode":"yolo"}', 'f'), /writeMode/);
    assert.throws(() => parsePolicyFile('{"denyread":[]}', 'f'), /unknown field/);
    assert.throws(() => parsePolicyFile('not json', 'f'), /not valid JSON/);
    const d = effectivePolicy('/r');
    assert.deepEqual([d.writeMode, d.execMode, d.network, d.log], ['ask', 'ask', 'deny', false]);
  });
});
