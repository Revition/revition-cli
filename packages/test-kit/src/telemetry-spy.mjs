// T1.4.2 AC1 (REVITION-CLI-PLAN.md:1707): "With no opt-in, zero network calls to the telemetry endpoint (spy) across
// the whole test suite." TEST-ONLY preload: scripts/test-all.mjs loads it into every process of the suite through
// NODE_OPTIONS, so every CLI process a test spawns (and the detached background worker, which inherits the env) is
// watched. It patches nothing: undici (the CLI transport, and Node's own fetch) publishes every request on the
// `undici:request:create` diagnostics channel; a request to the telemetry route is appended to the spy log with
// whether the run declared an opt-in (REVITION_TEST_TELEMETRY_OPTIN=1, set only by a test that opts in).
import diagnosticsChannel from 'node:diagnostics_channel';
import { appendFileSync } from 'node:fs';

const LOG = process.env.REVITION_TELEMETRY_SPY_LOG;
export const TELEMETRY_PATH = '/dev/cli/telemetry';

if (LOG) {
  diagnosticsChannel.channel('undici:request:create').subscribe((message) => {
    const path = String(message?.request?.path ?? '').split('?')[0];
    if (!path.endsWith(TELEMETRY_PATH)) return;
    const optIn = process.env.REVITION_TEST_TELEMETRY_OPTIN === '1';
    appendFileSync(LOG, `${JSON.stringify({ path, optIn, pid: process.pid })}\n`);
  });
}
