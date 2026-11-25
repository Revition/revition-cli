// T1.5.1 rules, run in CI on every PR (changeset-check.yml):
//   1. a PR that changes anything under packages/ adds at least one .changeset/*.md (the `docs-only` label exempts it);
//   2. a breaking changeset (bump `major`, or `**Breaking**` in a pre-1.0 note) carries a `## Migration` section and the
//      `## Versioning policy checklist` (docs/policy/versioning.md).
// Usage: node scripts/check-changesets.mjs <base ref>   (PR_LABELS = JSON array of label names, optional)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXEMPT_LABEL = 'docs-only';

const isChangeset = (f) => /^\.changeset\/[^/]+\.md$/.test(f) && f !== '.changeset/README.md';

/** The bumps a changeset declares in its front matter, e.g. `{ "@revition/cli": "minor" }`. */
export function parseChangeset(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (m === null) return null;
  const bumps = {};
  for (const line of m[1].split(/\r?\n/)) {
    const b = /^\s*["']?([^"':]+)["']?\s*:\s*(major|minor|patch)\s*$/.exec(line);
    if (b === null) {
      if (line.trim() !== '') return null;
      continue;
    }
    bumps[b[1].trim()] = b[2];
  }
  return { bumps, body: m[2] };
}

/** Every problem with a PR's changesets. PURE. */
export function changesetProblems({ changedFiles, changesets, labels }) {
  if (labels.includes(EXEMPT_LABEL)) return [];
  const problems = [];
  const touchesPackages = changedFiles.some((f) => f.startsWith('packages/'));
  if (touchesPackages && changesets.length === 0) {
    problems.push('this PR changes packages/ but adds no changeset: run `pnpm changeset` (or label it docs-only)');
  }
  for (const { file, text } of changesets) {
    const parsed = parseChangeset(text);
    if (parsed === null || Object.keys(parsed.bumps).length === 0) {
      problems.push(`${file}: not a valid changeset (front matter of "package": patch|minor|major lines)`);
      continue;
    }
    if (parsed.body.trim() === '') problems.push(`${file}: the user-facing note is empty`);
    const breaking = Object.values(parsed.bumps).includes('major') || /\*\*Breaking\*\*/.test(parsed.body);
    if (breaking && !/^## Migration\b/m.test(parsed.body)) problems.push(`${file}: a breaking change needs a "## Migration" section`);
    if (breaking && !/^## Versioning policy checklist\b/m.test(parsed.body)) {
      problems.push(`${file}: a breaking change needs the "## Versioning policy checklist" (docs/policy/versioning.md)`);
    }
  }
  return problems;
}

/** Reads the PR's changed files and added changesets from git (base...HEAD). */
export function readPr(root, base) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  const changedFiles = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
  const added = git('diff', '--name-only', '--diff-filter=A', `${base}...HEAD`).split('\n').filter(isChangeset);
  const changesets = added.filter((f) => existsSync(join(root, f))).map((f) => ({ file: f, text: readFileSync(join(root, f), 'utf8') }));
  return { changedFiles, changesets };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const base = process.argv[2] ?? 'origin/main';
  const labels = JSON.parse(process.env.PR_LABELS ?? '[]');
  const problems = changesetProblems({ ...readPr(process.cwd(), base), labels });
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log('check-changesets: ok');
}
