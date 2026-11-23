// T1.4.2 AC1 (REVITION-CLI-PLAN.md:1707): the whole test suite runs under the telemetry spy
// (packages/test-kit/src/telemetry-spy.mjs). After every suite has run, any request to the telemetry route from a run
// that did not opt in fails the suite, whatever each suite's own result was.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SPY = join(ROOT, 'packages', 'test-kit', 'src', 'telemetry-spy.mjs');
/** The suites, unchanged from the previous `test` script. */
export const SUITES = 'node --test "scripts/*.test.mjs" && node --import tsx --test "legacy-parity/*.test.mjs" && pnpm -r --if-present run test';

/** Telemetry requests the spy saw from a run that did not opt in (one JSON line each). PURE. */
export function telemetryViolations(logText) {
  return logText
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l))
    .filter((e) => e.optIn !== true);
}

/** NODE_OPTIONS with the spy preloaded (an absolute file URL, so a child in any cwd resolves it). PURE. */
export function withSpy(nodeOptions) {
  return `${nodeOptions ?? ''} --import=${pathToFileURL(SPY).href}`.trim();
}

function main() {
  const log = join(mkdtempSync(join(tmpdir(), 'rv-telemetry-spy-')), 'spy.jsonl');
  const r = spawnSync(SUITES, {
    cwd: ROOT,
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, REVITION_TELEMETRY_SPY_LOG: log, NODE_OPTIONS: withSpy(process.env.NODE_OPTIONS) },
  });
  const violations = existsSync(log) ? telemetryViolations(readFileSync(log, 'utf8')) : [];
  if (violations.length > 0) {
    process.stderr.write(`telemetry spy: ${violations.length} call(s) to the telemetry route without an opt-in:\n`);
    for (const v of violations) process.stderr.write(`  ${JSON.stringify(v)}\n`);
    process.exit(1);
  }
  process.stdout.write('telemetry spy: no telemetry call without an opt-in, across the whole suite\n');
  process.exit(r.status ?? 1);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main();
