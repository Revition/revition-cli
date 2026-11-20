import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkRepo, installHooksOf, installScriptProblems } from './check-install-scripts.mjs';
import { licenseAllowed, licenseProblems } from './check-licenses.mjs';
import { budgetProblems, MAX_UNPACKED_BYTES, packProblems } from './check-size.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A workspace whose shipped package depends (file:) on `dep`; installed with scripts disabled, offline. */
function workspaceWith(dep) {
  const root = mkdtempSync(join(tmpdir(), 'sc-ws-'));
  write(join(root, 'package.json'), '{"name":"ws","private":true}\n');
  write(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  write(join(root, 'vendor', 'dep', 'package.json'), JSON.stringify(dep));
  write(join(root, 'vendor', 'dep', 'index.js'), 'module.exports = 1;\n');
  write(join(root, 'packages', 'app', 'package.json'), JSON.stringify({ name: '@x/app', version: '1.0.0', dependencies: { [dep.name]: 'file:../../vendor/dep' } }));
  execFileSync('pnpm', ['install', '--ignore-scripts', '--offline', '--silent'], { cwd: root, stdio: 'ignore' });
  return root;
}

describe('T1.5.3 dependency and package hygiene', () => {
  it('[CLI-T1.5.3-AC1] adding a runtime dependency with a postinstall script fails the check; a clean one passes', () => {
    const evil = workspaceWith({ name: 'evil-dep', version: '1.0.0', license: 'MIT', scripts: { postinstall: 'node steal.js' } });
    assert.deepEqual(checkRepo(evil), ['evil-dep@1.0.0: runs postinstall on install']);
    const clean = workspaceWith({ name: 'clean-dep', version: '1.0.0', license: 'MIT' });
    assert.deepEqual(checkRepo(clean), []);
    assert.deepEqual(checkRepo(ROOT), [], 'this repository: no install script in our packages or any runtime dependency');
  });

  it('[CLI-T1.5.3-AC1] preinstall / install / a binding.gyp all count; the runtime allowlist is empty', () => {
    assert.deepEqual(installHooksOf({ scripts: { preinstall: 'x' } }, false), ['preinstall']);
    assert.deepEqual(installHooksOf({ scripts: { test: 'x' } }, true), ['install (binding.gyp)']);
    assert.deepEqual(installHooksOf({ scripts: { prepare: 'x', build: 'y' } }, false), []);
    assert.equal(installScriptProblems([{ name: 'a', version: '1', hooks: ['install'] }]).length, 1);
  });

  it('[CLI-T1.5.3-AC2] a package over the 5 MB unpacked budget fails; a file outside the allowlist fails; > 15 deps fails', () => {
    const base = { name: '@revition/cli', version: '1.0.0', files: [{ path: 'dist/index.js' }, { path: 'package.json' }] };
    assert.deepEqual(packProblems({ ...base, unpackedSize: MAX_UNPACKED_BYTES }), []);
    assert.deepEqual(packProblems({ ...base, unpackedSize: MAX_UNPACKED_BYTES + 1 }), [
      `@revition/cli@1.0.0: ${MAX_UNPACKED_BYTES + 1} bytes unpacked is over the ${MAX_UNPACKED_BYTES} byte budget`,
    ]);
    assert.deepEqual(packProblems({ ...base, unpackedSize: 10, files: [{ path: 'src/secret.ts' }] }), [
      '@revition/cli@1.0.0: ships src/secret.ts, outside the files allowlist',
    ]);
    const deps = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`d${i}`, '1.0.0']));
    assert.equal(budgetProblems([{ json: { name: 'a', dependencies: deps } }]).length, 1);
    assert.deepEqual(budgetProblems([{ json: { name: 'a', dependencies: { b: 'workspace:*', x: '1' } } }, { json: { name: 'b' } }]), []);
    const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'check-size.mjs')], { cwd: ROOT, encoding: 'utf8' });
    assert.match(out, /@revition\/cli@\S+: \d+ of 5242880 bytes unpacked/);
  });

  it('[CLI-T1.5.3-AC3] a disallowed licence fails (GPL, missing, unknown); MIT / Apache-2.0 / BSD / ISC / BlueOak-1.0.0 (ruling O98) pass; SPDX OR / AND', () => {
    for (const ok of ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'BlueOak-1.0.0', '(MIT OR CC0-1.0)', 'MIT AND ISC']) {
      assert.equal(licenseAllowed(ok), true, ok);
    }
    for (const bad of ['GPL-3.0-only', 'AGPL-3.0', '', undefined, 'UNLICENSED', 'MIT AND GPL-2.0', 'BlueOak-2.0.0', 'Apache-2.0 WITH LLVM-exception']) {
      assert.equal(licenseAllowed(bad), false, String(bad));
    }
    assert.deepEqual(licenseProblems([{ name: 'gpl-thing', versions: ['2.0.0'], license: 'GPL-3.0-only' }]), [
      'gpl-thing@2.0.0: licence GPL-3.0-only is not on the allowlist (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, BlueOak-1.0.0)',
    ]);
  });

  it('[CLI-T1.5.3-AC4] every release build produces the CycloneDX SBOM into the uploaded release artifacts', () => {
    const wf = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
    const sboms = wf.match(/format: cyclonedx-json\n\s+output-file: release-artifacts\/sbom\.cdx\.json/g) ?? [];
    assert.equal(sboms.length, 2, 'both the canary build and the stable build');
    assert.equal((wf.match(/path: release-artifacts\/\n\s+if-no-files-found: error/g) ?? []).length, 2);
  });
});
