// T1.5.3 rule: ZERO install lifecycle scripts in our packages and in every runtime dependency. The allowlist for
// runtime dependencies is empty and stays empty. A native module that would build on install (a binding.gyp, which
// npm runs through node-gyp) counts as an install script: the keychain binding must ship prebuilt binaries (ADR 0005).
// Usage: node scripts/check-install-scripts.mjs   (from the repository root, after `pnpm install --ignore-scripts`)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runtimeClosure, shippedPackages } from './runtime-deps.mjs';

export const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall'];
export const RUNTIME_ALLOWLIST = Object.freeze([]);

/** What one package would run on install. PURE (given its package.json and whether it has a binding.gyp). */
export function installHooksOf(json, hasBindingGyp) {
  const hooks = INSTALL_HOOKS.filter((h) => typeof json?.scripts?.[h] === 'string' && json.scripts[h].trim() !== '');
  return hasBindingGyp && !hooks.includes('install') ? [...hooks, 'install (binding.gyp)'] : hooks;
}

/** Problems for a list of { name, version, hooks }. PURE. */
export function installScriptProblems(pkgs, allowlist = RUNTIME_ALLOWLIST) {
  return pkgs
    .filter((p) => p.hooks.length > 0 && !allowlist.includes(p.name))
    .map((p) => `${p.name}@${p.version}: runs ${p.hooks.join(', ')} on install`);
}

export function inspect(dir) {
  const json = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  return { name: json.name, version: json.version, hooks: installHooksOf(json, existsSync(join(dir, 'binding.gyp'))) };
}

export function checkRepo(root) {
  const ours = shippedPackages(root).map((p) => inspect(p.dir));
  const deps = runtimeClosure(root).map((d) => inspect(d.path));
  return installScriptProblems([...ours, ...deps]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = checkRepo(process.cwd());
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log('check-install-scripts: no install scripts in our packages or any runtime dependency');
}
