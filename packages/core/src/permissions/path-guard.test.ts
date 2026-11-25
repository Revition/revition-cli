import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { assertTextFile, globToRegExp, guardPath, MAX_FILE_BYTES, PolicyRefusal } from './path-guard.js';
import { effectivePolicy } from './policy.js';

/** T3.3.2 AC1 - path confinement after realpath: the traversal / symlink matrix on a real filesystem. */
function project(): { root: string; outside: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'pg-')));
  const root = join(base, 'proj');
  const outside = join(base, 'outside');
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(root, 'src', 'a.ts'), 'export {};\n');
  writeFileSync(join(outside, 'secret.txt'), 'outside\n');
  return { root, outside };
}

const refused = (fn: () => unknown, re: RegExp): void => {
  assert.throws(fn, (e: unknown) => e instanceof PolicyRefusal && re.test(e.message));
};

describe('T3.3.2 path guard', () => {
  it('[CLI-T3.3.2-AC1] a symlink (file or directory) pointing outside the root is refused, for read, write and list', () => {
    const { root, outside } = project();
    symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));
    symlinkSync(outside, join(root, 'src', 'out-dir'));
    const p = effectivePolicy(root);
    for (const purpose of ['read', 'write', 'list'] as const) {
      refused(() => guardPath(p, 'link.txt', purpose), /outside the project/);
      refused(() => guardPath(p, 'src/out-dir/secret.txt', purpose), /outside the project/);
      refused(() => guardPath(p, 'src/out-dir/new.txt', purpose), /outside the project/);
    }
  });

  it('[CLI-T3.3.2-AC1] ../ traversal, absolute paths outside, and a dangling link are refused; inside paths resolve', () => {
    const { root, outside } = project();
    const p = effectivePolicy(root);
    for (const bad of ['../outside/secret.txt', 'src/../../outside/secret.txt', join(outside, 'secret.txt'), '/etc/passwd', '..']) {
      refused(() => guardPath(p, bad, 'read'), /outside the project/);
    }
    symlinkSync(join(outside, 'not-yet.txt'), join(root, 'dangling.txt'));
    refused(() => guardPath(p, 'dangling.txt', 'write'), /missing target/);
    assert.deepEqual(guardPath(p, 'src/a.ts', 'read'), { abs: join(root, 'src', 'a.ts'), rel: 'src/a.ts' });
    assert.equal(guardPath(p, join(root, 'src', 'new.ts'), 'write').rel, 'src/new.ts');
    assert.equal(guardPath(p, '.', 'list').rel, '');
    // An inside link to an inside file is fine (it resolves to the real file).
    symlinkSync(join(root, 'src', 'a.ts'), join(root, 'alias.ts'));
    assert.equal(guardPath(p, 'alias.ts', 'read').rel, 'src/a.ts');
  });

  it('edge: large and binary files are refused; the glob rules', () => {
    const { root } = project();
    writeFileSync(join(root, 'big.txt'), 'x'.repeat(MAX_FILE_BYTES + 1));
    writeFileSync(join(root, 'bin.dat'), Buffer.from([1, 2, 0, 3]));
    const p = effectivePolicy(root);
    refused(() => assertTextFile(guardPath(p, 'big.txt', 'read')), /larger than/);
    refused(() => assertTextFile(guardPath(p, 'bin.dat', 'read')), /binary/);
    assert.ok(globToRegExp('.env*').test('a/b/.env.local'));
    assert.ok(globToRegExp('**/*.pem').test('k.pem') && globToRegExp('**/*.pem').test('x/y/k.pem'));
    assert.ok(!globToRegExp('.git/config').test('src/.git/config'));
    assert.ok(globToRegExp('node_modules/.cache/**').test('node_modules/.cache/x/y'));
  });
});
