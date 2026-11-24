// T1.5.3 rules for what we publish:
//   - each package is <= 5 MB unpacked (`npm pack --dry-run` reports the size against the budget);
//   - it ships only the `files` allowlist: dist, bin, oclif.manifest.json, README, LICENSE (+ package.json, which npm
//     always adds, and NOTICE / CHANGELOG.md);
//   - the runtime dependency budget: <= 15 direct (non-workspace) dependencies across the shipped packages.
// Usage: node scripts/check-size.mjs   (from the repository root, after `pnpm build`)
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { shippedPackages } from './runtime-deps.mjs';

export const MAX_UNPACKED_BYTES = 5 * 1024 * 1024;
export const MAX_DIRECT_DEPS = 15;
const ALLOWED_PATH = /^(dist\/|bin\/|oclif\.manifest\.json$|package\.json$|README(\.md)?$|LICEN[SC]E(\.md)?$|NOTICE(\.md)?$|CHANGELOG\.md$)/i;

/** Problems for one `npm pack --dry-run --json` result. PURE. */
export function packProblems(pack, max = MAX_UNPACKED_BYTES) {
  const problems = [];
  if (pack.unpackedSize > max) {
    problems.push(`${pack.name}@${pack.version}: ${pack.unpackedSize} bytes unpacked is over the ${max} byte budget`);
  }
  for (const f of pack.files ?? []) {
    if (!ALLOWED_PATH.test(f.path)) problems.push(`${pack.name}@${pack.version}: ships ${f.path}, outside the files allowlist`);
  }
  return problems;
}

/** The direct runtime dependencies across the shipped packages, workspace packages excluded. PURE. */
export function directRuntimeDeps(packages) {
  const names = new Set(packages.map((p) => p.json.name));
  const deps = new Set();
  for (const p of packages) {
    for (const [name, spec] of Object.entries(p.json.dependencies ?? {})) {
      if (!names.has(name) && !String(spec).startsWith('workspace:')) deps.add(name);
    }
  }
  return [...deps].sort();
}

export function budgetProblems(packages, max = MAX_DIRECT_DEPS) {
  const deps = directRuntimeDeps(packages);
  return deps.length > max ? [`${deps.length} direct runtime dependencies is over the budget of ${max}: ${deps.join(', ')}`] : [];
}

export function dryRunPack(dir) {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32' });
  return JSON.parse(out)[0];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const packages = shippedPackages(process.cwd());
  const problems = [...budgetProblems(packages)];
  for (const p of packages) {
    const pack = dryRunPack(p.dir);
    console.log(`${pack.name}@${pack.version}: ${pack.unpackedSize} of ${MAX_UNPACKED_BYTES} bytes unpacked, ${pack.files.length} files`);
    problems.push(...packProblems(pack));
  }
  console.log(`direct runtime dependencies: ${directRuntimeDeps(packages).length} of ${MAX_DIRECT_DEPS}`);
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
}
