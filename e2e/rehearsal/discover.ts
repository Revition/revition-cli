// Discovery helper (not a test): run one journey against the journey platform and print every call and case.
//   node --import tsx e2e/rehearsal/discover.ts phase1
import { startJourneyPlatform } from './journey-platform.js';
import { REHEARSAL_TOKEN, runJourney } from './run-journey.js';

const phase = process.argv[2] ?? 'phase1';
const p = await startJourneyPlatform(REHEARSAL_TOKEN);
try {
  const env = Object.fromEntries(process.argv.slice(3).map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]));
  const run = await runJourney(phase, p.host, env);
  for (const c of p.calls) console.log('CALL', c.status, c.method, c.path, c.operation ?? '-', c.problems.join('; '));
  for (const c of run.cases) console.log('CASE', c.status, '|', c.name, '|', c.message.slice(0, 400));
  console.log('EXIT', run.code);
  if (run.cases.length === 0) console.log(run.stderr.slice(0, 3000));
} finally {
  p.close();
}
