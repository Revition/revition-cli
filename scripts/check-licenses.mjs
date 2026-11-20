// T1.5.3 rule: every runtime dependency is under an allowed licence: MIT, Apache-2.0, BSD (2- or 3-clause), ISC or
// BlueOak-1.0.0 (REVITION-CLI-PLAN ruling O98, 2026-11-14: OSI-approved, Blue Oak Gold, the licence of minimatch which
// the plan-pinned @oclif/core requires). An SPDX `OR` expression passes when any alternative is allowed; `AND` needs
// all. Unknown or missing = refused.
// Usage: node scripts/check-licenses.mjs   (from the repository root)
import { fileURLToPath } from 'node:url';

import { runtimeClosure } from './runtime-deps.mjs';

export const ALLOWED = Object.freeze(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'BlueOak-1.0.0']);

/** Whether an SPDX expression is allowed. PURE. */
export function licenseAllowed(expr, allowed = ALLOWED) {
  if (typeof expr !== 'string' || expr.trim() === '') return false;
  const e = expr.trim().replace(/^\((.*)\)$/, '$1');
  if (/ OR /i.test(e)) return e.split(/ OR /i).some((x) => licenseAllowed(x, allowed));
  if (/ AND /i.test(e)) return e.split(/ AND /i).every((x) => licenseAllowed(x, allowed));
  return allowed.includes(e.trim());
}

/** Problems for a list of { name, versions, license }. PURE. */
export function licenseProblems(deps, allowed = ALLOWED) {
  return deps
    .filter((d) => !licenseAllowed(d.license, allowed))
    .map((d) => `${d.name}@${(d.versions ?? []).join(',')}: licence ${d.license || 'missing'} is not on the allowlist (${allowed.join(', ')})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = licenseProblems(runtimeClosure(process.cwd()));
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log(`check-licenses: every runtime dependency is ${ALLOWED.join(' / ')}`);
}
