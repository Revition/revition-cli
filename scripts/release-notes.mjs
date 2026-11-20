// T1.5.1 - the root release notes. After `changeset version` writes each package's CHANGELOG.md, this collects every
// package's newest section into the root CHANGELOG.md (newest release first). Idempotent: a package version already
// listed is not added twice. Run by the release workflow's version step: `changeset version && node scripts/release-notes.mjs`.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEADER = '# Changelog\n\nRelease notes for every package in this repository, newest first. Each package also keeps its own\n`CHANGELOG.md`.\n';

/** The body of the `## <version>` section of a package changelog, or null. PURE. */
export function sectionFor(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `## ${version}`);
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}

/** The new root CHANGELOG.md text. PURE. */
export function aggregate(rootText, packages, date) {
  const current = rootText.trim() === '' ? HEADER : rootText;
  const entries = packages
    .filter((p) => p.section !== null && !current.includes(`### ${p.name} ${p.version}\n`))
    .map((p) => `### ${p.name} ${p.version}\n\n${p.section}\n`);
  if (entries.length === 0) return current;
  const block = `## ${date}\n\n${entries.join('\n')}`;
  const at = current.indexOf('\n## ');
  return at < 0 ? `${current.trimEnd()}\n\n${block}` : `${current.slice(0, at + 1)}${block}\n${current.slice(at + 1)}`;
}

export function readPackages(root) {
  return ['packages', 'plugins']
    .map((group) => join(root, group))
    .filter((dir) => existsSync(dir))
    .flatMap((dir) =>
      readdirSync(dir)
        .filter((d) => existsSync(join(dir, d, 'package.json')))
        .map((d) => {
          const pkg = JSON.parse(readFileSync(join(dir, d, 'package.json'), 'utf8'));
          const file = join(dir, d, 'CHANGELOG.md');
          const section = existsSync(file) ? sectionFor(readFileSync(file, 'utf8'), pkg.version) : null;
          return { name: pkg.name, version: pkg.version, section };
        })
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const file = join(root, 'CHANGELOG.md');
  const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  const after = aggregate(before, readPackages(root), date);
  if (after !== before) writeFileSync(file, after.endsWith('\n') ? after : `${after}\n`);
  console.log(after === before ? 'release-notes: nothing new' : 'release-notes: root CHANGELOG.md updated');
}
