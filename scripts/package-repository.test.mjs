// CLI-T1.5.1 (canary publish with provenance): npm verifies a provenance bundle against the package's own
// `repository.url`. Release run 45976514893 (895abe907) failed "Publish canary" with E422: `"repository.url" is "",
// expected to match "https://github.com/Revition/..."`, because no published package.json declared `repository`.
// Every PUBLIC package must name this repository and its own directory in it.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://github.com/Revition/revition-cli';

function workspacePackages() {
  const out = [];
  for (const group of ['packages', 'plugins']) {
    for (const name of readdirSync(join(ROOT, group))) {
      const file = join(ROOT, group, name, 'package.json');
      if (existsSync(file)) out.push({ dir: `${group}/${name}`, pkg: JSON.parse(readFileSync(file, 'utf8')) });
    }
  }
  return out;
}

describe('[CLI-T1.5.1-AC1] every published package names this repository (npm provenance)', () => {
  it('[CLI-T1.5.1-AC1] each public package.json has repository { type git, url, directory } pointing at itself', () => {
    const published = workspacePackages().filter((p) => p.pkg.private !== true);
    assert.ok(published.length >= 7, `the published packages are found (${published.length})`);
    for (const { dir, pkg } of published) {
      assert.deepEqual(pkg.repository, { type: 'git', url: REPO, directory: dir }, `${pkg.name} repository`);
    }
  });
});
