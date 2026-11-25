import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { changesetProblems, parseChangeset } from './check-changesets.mjs';
import { aggregate, sectionFor } from './release-notes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = join(ROOT, 'scripts', 'check-changesets.mjs');
const NOTES = join(ROOT, 'scripts', 'release-notes.mjs');

const MINOR = '---\n"@revition/cli": minor\n---\n\nAdd `revition thing`.\n';
const MAJOR_BARE = '---\n"@revition/cli": major\n---\n\nRemove `revition old`.\n';
const MAJOR_OK = `${MAJOR_BARE}\n## Migration\n\nUse \`revition new\`.\n\n## Versioning policy checklist\n\n- [x] rule 1 (command removed)\n`;

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
}

/** A throwaway repo: a base commit, then a PR commit with `files`. Returns the dir and the base sha. */
function prRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'cs-pr-'));
  git(dir, 'init', '-q', '-b', 'main');
  mkdirSync(join(dir, 'packages', 'cli', 'src'), { recursive: true });
  writeFileSync(join(dir, 'packages', 'cli', 'src', 'a.ts'), 'export const a = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  const base = git(dir, 'rev-parse', 'HEAD');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'pr');
  return { dir, base };
}

function runCheck(dir, base, labels = []) {
  return spawnSync(process.execPath, [CHECK, base], { cwd: dir, encoding: 'utf8', env: { ...process.env, PR_LABELS: JSON.stringify(labels) } });
}

describe('T1.5.1 changesets', () => {
  it('[CLI-T1.5.1-AC1] a PR changing packages/ without a changeset fails; with one it passes; docs-only is exempt', () => {
    const without = prRepo({ 'packages/cli/src/a.ts': 'export const a = 2;\n' });
    const r1 = runCheck(without.dir, without.base);
    assert.equal(r1.status, 1);
    assert.match(r1.stderr, /adds no changeset/);
    assert.equal(runCheck(without.dir, without.base, ['docs-only']).status, 0);

    const withOne = prRepo({ 'packages/cli/src/a.ts': 'export const a = 2;\n', '.changeset/brave-cat.md': MINOR });
    assert.equal(runCheck(withOne.dir, withOne.base).status, 0);

    const docs = prRepo({ 'docs/x.md': '# x\n' });
    assert.equal(runCheck(docs.dir, docs.base).status, 0, 'a docs-only change needs no changeset');
  });

  it('[CLI-T1.5.1-AC1] a breaking changeset needs the migration note and the versioning-policy checklist', () => {
    const bare = prRepo({ 'packages/cli/src/a.ts': 'x\n', '.changeset/big-dog.md': MAJOR_BARE });
    const r = runCheck(bare.dir, bare.base);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /needs a "## Migration" section/);
    assert.match(r.stderr, /Versioning policy checklist/);
    const ok = prRepo({ 'packages/cli/src/a.ts': 'x\n', '.changeset/big-dog.md': MAJOR_OK });
    assert.equal(runCheck(ok.dir, ok.base).status, 0);
    // pre-1.0: a breaking change is a minor bump marked **Breaking**; the same rule applies
    const pre = changesetProblems({ changedFiles: ['packages/cli/a.ts'], changesets: [{ file: 'p.md', text: '---\n"@revition/cli": minor\n---\n\n**Breaking** x\n' }], labels: [] });
    assert.equal(pre.length, 2);
    assert.equal(parseChangeset('not a changeset'), null);
  });

  it('[CLI-T1.5.1-AC2] the release dry run: changeset version bumps versions and writes package + root changelogs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cs-ver-'));
    for (const f of ['package.json', 'pnpm-workspace.yaml', '.changeset/config.json', 'CHANGELOG.md']) {
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      cpSync(join(ROOT, f), join(dir, f));
    }
    for (const p of ['cli', 'core', 'api-client']) {
      mkdirSync(join(dir, 'packages', p), { recursive: true });
      cpSync(join(ROOT, 'packages', p, 'package.json'), join(dir, 'packages', p, 'package.json'));
    }
    symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
    writeFileSync(join(dir, '.changeset', 'brave-cat.md'), MINOR);
    writeFileSync(join(dir, '.changeset', 'calm-owl.md'), '---\n"@revition/cli-core": patch\n---\n\nFix a retry.\n');
    const before = JSON.parse(readFileSync(join(dir, 'packages', 'cli', 'package.json'), 'utf8')).version;
    execFileSync(join(ROOT, 'node_modules', '.bin', 'changeset'), ['version'], { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32' });
    execFileSync(process.execPath, [NOTES, '2026-11-18'], { cwd: dir, encoding: 'utf8' });

    const cli = JSON.parse(readFileSync(join(dir, 'packages', 'cli', 'package.json'), 'utf8'));
    const core = JSON.parse(readFileSync(join(dir, 'packages', 'core', 'package.json'), 'utf8'));
    assert.equal(before, '0.1.0');
    assert.equal(cli.version, '0.2.0');
    assert.equal(core.version, '0.0.1');
    assert.match(readFileSync(join(dir, 'packages', 'cli', 'CHANGELOG.md'), 'utf8'), /## 0\.2\.0[\s\S]*Add `revition thing`\./);
    assert.match(readFileSync(join(dir, 'packages', 'core', 'CHANGELOG.md'), 'utf8'), /## 0\.0\.1[\s\S]*Fix a retry\./);
    assert.equal(existsSync(join(dir, '.changeset', 'brave-cat.md')), false, 'applied changesets are consumed');
    const root = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
    assert.match(root, /## 2026-11-18[\s\S]*### @revition\/cli 0\.2\.0[\s\S]*Add `revition thing`\.[\s\S]*### @revition\/cli-core 0\.0\.1/);
    // idempotent: a second run adds nothing
    execFileSync(process.execPath, [NOTES, '2026-11-19'], { cwd: dir, encoding: 'utf8' });
    assert.equal(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), root);
  });

  it('[CLI-T1.5.1-AC2] release notes: the newest section only; the newest release first', () => {
    const log = '# x\n\n## 0.2.0\n\n### Minor Changes\n\n- new\n\n## 0.1.0\n\n- old\n';
    assert.equal(sectionFor(log, '0.2.0'), '### Minor Changes\n\n- new');
    const first = aggregate('', [{ name: 'a', version: '1.0.0', section: '- one' }], '2026-01-01');
    const second = aggregate(first, [{ name: 'a', version: '1.1.0', section: '- two' }], '2026-02-01');
    assert.ok(second.indexOf('## 2026-02-01') < second.indexOf('## 2026-01-01'));
  });
});
