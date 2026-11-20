// T1.1.5 AC6: a changed openapi/v1.json without regeneration fails (the same --check the CI typecheck step runs), and
// so does a hand edit of the generated client.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const PKG = fileURLToPath(new URL('..', import.meta.url));

async function copyPackage() {
  const dir = await mkdtemp(join(tmpdir(), 'revclient-'));
  for (const p of ['scripts', 'openapi', 'src', 'contract.lock.json', 'package.json']) await cp(join(PKG, p), join(dir, p), { recursive: true });
  await symlink(join(PKG, 'node_modules'), join(dir, 'node_modules'), 'junction');
  return dir;
}

function check(dir) {
  try {
    execFileSync(process.execPath, [join(dir, 'scripts', 'generate.mjs'), '--check'], { stdio: 'pipe' });
    return { ok: true, stderr: '' };
  } catch (e) {
    return { ok: false, stderr: String(e.stderr) };
  }
}

describe('T1.1.5 the generated client never drifts from the contract', () => {
  it('[CLI-T1.1.5-AC6] the committed client matches openapi/v1.json; a changed contract without regeneration fails', async () => {
    const dir = await copyPackage();
    assert.equal(check(dir).ok, true);
    const specFile = join(dir, 'openapi', 'v1.json');
    const spec = JSON.parse(await readFile(specFile, 'utf8'));
    spec.info.version = '2099-01-01';
    await writeFile(specFile, JSON.stringify(spec, null, 2));
    const r = check(dir);
    assert.equal(r.ok, false);
    assert.match(r.stderr, /contract\.lock\.json, src\/index\.ts differ/);
  });

  it('[CLI-T1.1.5-AC6] a hand edit of the generated client fails', async () => {
    const dir = await copyPackage();
    const index = join(dir, 'src', 'index.ts');
    await writeFile(index, `${await readFile(index, 'utf8')}\nexport const handEdit = 1;\n`);
    const r = check(dir);
    assert.equal(r.ok, false);
    assert.match(r.stderr, /src\/index\.ts differ/);
  });
});
