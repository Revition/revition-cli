// T1.5.3 - the shipped packages and their RUNTIME dependency closure (production dependencies only, as resolved by
// pnpm for the installed lockfile). Shared by check-install-scripts.mjs and check-licenses.mjs.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Every workspace package under packages/ and plugins/ (the ones that ship). */
export function shippedPackages(root) {
  return ['packages', 'plugins']
    .map((group) => join(root, group))
    .filter((dir) => existsSync(dir))
    .flatMap((dir) =>
      readdirSync(dir)
        .filter((d) => existsSync(join(dir, d, 'package.json')))
        .map((d) => ({ dir: join(dir, d), json: JSON.parse(readFileSync(join(dir, d, 'package.json'), 'utf8')) }))
    );
}

/** The runtime closure: one entry per installed (name, version, path), from `pnpm licenses list --prod --json`. */
export function runtimeClosure(root) {
  const seen = new Map();
  for (const p of shippedPackages(root)) {
    const out = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], { cwd: p.dir, encoding: 'utf8' });
    const byLicense = out.trim() === '' ? {} : JSON.parse(out);
    for (const [license, entries] of Object.entries(byLicense)) {
      for (const e of entries) {
        for (const path of e.paths ?? []) {
          if (!seen.has(path)) seen.set(path, { name: e.name, versions: e.versions, license, path });
        }
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
