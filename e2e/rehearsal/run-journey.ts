/**
 * The full-sequence $0 dress rehearsal of a phase journey (e2e/phaseN.e2e.ts): the SAME journey file, unchanged, run by
 * node:test against a scripted platform on 127.0.0.1 instead of staging. Nothing leaves the machine (the journey's only
 * host is the mock), no paid call exists on the mock, and the token is a fake `rvt_` value.
 *
 *   runJourney('phase1', mock.host) -> { code, junit } (the journey's own junit report)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REHEARSAL_TOKEN = `rvt_${'R'.repeat(40)}`;
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export interface JourneyCase {
  readonly name: string;
  readonly status: 'passed' | 'failed' | 'skipped';
  readonly message: string;
}

export interface JourneyRun {
  readonly code: number | null;
  readonly cases: readonly JourneyCase[];
  readonly junit: string;
  readonly stderr: string;
}

function casesOf(xml: string): JourneyCase[] {
  const out: JourneyCase[] = [];
  const re = /<testcase name="([^"]*)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/gu;
  for (const m of xml.matchAll(re)) {
    const inner = m[3] ?? '';
    const name = m[1]!.replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&quot;/gu, '"').replace(/&amp;/gu, '&');
    const failure = /<failure[^>]*message="([^"]*)"/u.exec(inner);
    out.push({ name, status: /<skipped/u.test(inner) ? 'skipped' : failure ? 'failed' : 'passed', message: failure?.[1] ?? '' });
  }
  return out;
}

export function runJourney(phase: string, host: string, extraEnv: Record<string, string> = {}): Promise<JourneyRun> {
  const out = join(mkdtempSync(join(tmpdir(), `rehearsal-${phase}-`)), 'junit.xml');
  // A journey started from inside a node:test run must be its OWN test run: without this, the child inherits the
  // parent's NODE_TEST_CONTEXT and reports to the parent instead of writing its junit.
  const { NODE_TEST_CONTEXT: _parent, ...inherited } = process.env;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--test', '--test-reporter=junit', `--test-reporter-destination=${out}`, join(ROOT, 'e2e', `${phase}.e2e.ts`)],
      {
        cwd: ROOT,
        env: { ...inherited, REVITION_E2E_HOST: host, REVITION_E2E_TOKEN: REHEARSAL_TOKEN, NO_COLOR: '1', ...extraEnv },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.stdout.resume();
    child.on('error', reject);
    child.on('close', (code) => {
      let junit: string;
      try {
        junit = readFileSync(out, 'utf8');
      } catch {
        junit = '';
      }
      resolve({ code, cases: casesOf(junit), junit, stderr });
    });
  });
}
