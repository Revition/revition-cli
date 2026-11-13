/**
 * `revition` — the CLI authoring mode (T2.11.5): a peer of the web IDE and the Synapse coding agent over the ONE
 * Extension SDK and the ONE pipeline.
 *
 *   scaffold <starter> [dir]      write a starter's project (the platform's files, one layout) into a new directory
 *   build [--dir d]               the free, local part of the build: the platform checks the files, by file
 *   test [--dir d]                run every capability's tests HERE against the stubbed SDK (fixtures.json)
 *   deploy --agent a [--dir d]    propose the project onto the agent as a branch (an Owner / Admin reviews it)
 *   eval --agent a --branch b     the pipeline on an approved branch: build, scan, sandbox tests, evaluation;
 *        [--yes]                  quoted first, runs only with --yes
 *
 * Nothing here builds, binds, approves or promotes on its own: `deploy` lands a branch exactly where the coding
 * agent's work lands, and `eval` runs the one pipeline, which refuses an unapproved branch.
 */

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  ApiClient,
  ApiError,
  DEFAULT_API_URL,
  type PipelineResult,
  type ProjectCapability,
  type ProjectCheck,
  type ProjectFiles,
  type SdkReference,
} from './client';
import { localDevPorts, serveLocalSdk, type Fixtures, type LocalCall } from './local-dev';
import { runLocally } from './local-run';
import { readProjectDir, writeProjectDir } from './project-dir';

export interface CliIo {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** Injected in tests; the real CLI uses the global fetch. */
  readonly fetch?: typeof fetch;
  /** Injected in tests; the real CLI waits for real (the background pipeline poll). */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** F5 (R396): a background pipeline is read again at the web panel's cadence, up to the routes lambda's timeout. */
export const PIPELINE_POLL_MS = 3_000;
export const PIPELINE_WAIT_MS = 15 * 60_000;

export const USAGE = [
  'usage: revition <command>',
  '  scaffold <starter> [dir]      write a starter project into a new directory',
  '  build [--dir d]               check the project (the build’s own checks, free)',
  '  test [--dir d]                run the tests locally against stubbed SDK ports (fixtures.json)',
  '  deploy --agent a [--dir d]    propose the project onto an agent as a branch for review',
  '  eval --agent a --branch b     quote, then (--yes) run the pipeline on an approved branch',
  'env: REVITION_TOKEN (required), REVITION_API_URL (default https://api.revition.com/api/v1)',
].join('\n');

const LOCAL_TIMEOUT_MS = 10_000;

function canonical(v: unknown): string {
  if (Array.isArray(v)) {
    return `[${v.map(canonical).join(',')}]`;
  }
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

function client(io: CliIo): ApiClient {
  const token = io.env['REVITION_TOKEN'];
  if (token === undefined || token === '') {
    throw new Error('set REVITION_TOKEN to your Revition access token');
  }
  return new ApiClient({
    baseUrl: io.env['REVITION_API_URL'] ?? DEFAULT_API_URL,
    token,
    ...(io.fetch !== undefined ? { fetch: io.fetch } : {}),
  });
}

function printCheck(io: CliIo, check: ProjectCheck): void {
  for (const [id, log] of Object.entries(check.buildLogs)) {
    io.out(`${id}:`);
    for (const line of log) {
      io.out(`  ${line}`);
    }
  }
  for (const w of check.warnings) {
    io.out(`warning ${w.file}: ${w.message}`);
  }
  for (const p of check.problems) {
    io.err(`problem ${p.file}: ${p.message}`);
  }
  io.out(check.ok ? 'ok: the project passes the build’s checks' : 'the project has problems');
}

async function scaffold(io: CliIo, positionals: readonly string[]): Promise<number> {
  const starter = positionals[0];
  if (starter === undefined) {
    io.err('scaffold needs a starter id (see the Developer Portal: Starters)');
    return 2;
  }
  const dir = resolve(io.cwd, positionals[1] ?? starter);
  const s = await client(io).starter(starter);
  for (const f of writeProjectDir(dir, s.files)) {
    io.out(`wrote ${f}`);
  }
  io.out(`${s.title} is in ${dir}. Next: revition build, then revition test.`);
  return 0;
}

async function build(io: CliIo, dir: string): Promise<number> {
  const check = await client(io).check(readProjectDir(dir));
  printCheck(io, check);
  return check.ok ? 0 : 1;
}

function fixturesOf(files: ProjectFiles): Fixtures {
  const raw = files['fixtures.json'];
  if (raw === undefined) {
    return {};
  }
  const v = JSON.parse(raw) as unknown;
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error('fixtures.json is an object of SDK call name to result');
  }
  return v as Fixtures;
}

interface LocalPorts {
  readonly handler: ReturnType<typeof localDevPorts>;
  readonly calls: LocalCall[];
}

function localDevPortsFor(
  ref: SdkReference,
  check: ProjectCheck,
  c: ProjectCapability,
  fixtures: Fixtures
): LocalPorts {
  const calls: LocalCall[] = [];
  return { handler: localDevPorts(ref, check.granted[c.upload.id] ?? [], fixtures, calls), calls };
}

/** One capability's tests, run here against its stubbed ports. Returns how many failed. */
async function testCapability(io: CliIo, c: ProjectCapability, ports: LocalPorts): Promise<number> {
  let failed = 0;
  const sdk = await serveLocalSdk(ports.handler);
  try {
    for (const t of c.tests) {
      const r = await runLocally(c.upload, t.input, sdk, { timeoutMs: LOCAL_TIMEOUT_MS });
      const passed = r.ok && canonical(r.output) === canonical(t.expect);
      failed += passed ? 0 : 1;
      io.out(`${passed ? 'PASS' : 'FAIL'} ${c.upload.id}: ${t.name}`);
      if (passed) {
        continue;
      }
      io.out(
        r.ok
          ? `  returned ${canonical(r.output)}, expected ${canonical(t.expect)}`
          : `  ${r.message ?? 'the run failed'}`
      );
      for (const l of r.logs) {
        io.out(`  | ${l}`);
      }
    }
  } finally {
    await sdk.close();
  }
  for (const call of ports.calls) {
    const how = call.answer.ok
      ? 'answered from fixtures (nothing real touched)'
      : call.answer.reason;
    io.out(`  sdk ${call.call}: ${how}`);
  }
  return failed;
}

async function test(io: CliIo, dir: string): Promise<number> {
  const files = readProjectDir(dir);
  const api = client(io);
  const check = await api.check(files);
  if (check.project === null || !check.ok) {
    printCheck(io, check);
    return 1;
  }
  const ref = await api.sdkReference();
  const fixtures = fixturesOf(files);
  let failed = 0;
  for (const c of check.project.capabilities) {
    failed += await testCapability(io, c, localDevPortsFor(ref, check, c, fixtures));
  }
  io.out(failed === 0 ? 'all tests passed locally' : `${failed} test(s) failed`);
  return failed === 0 ? 0 : 1;
}

async function deploy(io: CliIo, dir: string, agent: string | undefined): Promise<number> {
  if (agent === undefined) {
    io.err('deploy needs --agent <agentId>');
    return 2;
  }
  const b = await client(io).proposeBranch(agent, readProjectDir(dir));
  io.out(`proposed ${b.branch} (${b.branchId}) with ${b.files.join(', ')}`);
  for (const p of b.permissionDiff) {
    io.out(`  needs ${p.permission}: an Owner or Admin must grant it`);
  }
  io.out(
    `Next: an Owner or Admin reviews the branch; then revition eval --agent ${agent} --branch ${b.branchId}`
  );
  return 0;
}

async function evaluate(
  io: CliIo,
  agent: string | undefined,
  branch: string | undefined,
  yes: boolean
): Promise<number> {
  if (agent === undefined || branch === undefined) {
    io.err('eval needs --agent <agentId> --branch <branchId>');
    return 2;
  }
  const api = client(io);
  const quote = await api.pipelineQuote(agent, branch);
  io.out(
    `quote ${quote.quoteId}: ${quote.sandboxRuns} sandbox test run(s) at ${canonical(quote.limits)}`
  );
  if (!yes) {
    io.out('Nothing ran. Re-run with --yes to run the pipeline against this quote.');
    return 0;
  }
  const ran = await api.runPipeline(agent, branch, quote.quoteId);
  const r =
    'artifactRef' in ran
      ? { ...ran, promoted: evaluationPassed(ran.stages) }
      : await awaitBackgroundPipeline(io, api, agent, branch);
  if (r === null) {
    io.err(`the pipeline is still running after ${PIPELINE_WAIT_MS / 60_000} min; re-read the branch later`);
    return 1;
  }
  for (const s of r.stages) {
    io.out(`${s.stage}: ${s.status}${s.detail === '' ? '' : ` (${s.detail})`}`);
  }
  io.out(pipelineEndLine(r));
  return promotedRef(r) !== null ? 0 : 1;
}

/** A pipeline's end as `eval` reads it: its stages, the artifact it froze, and whether it was promoted. */
interface PipelineEnd extends PipelineResult {
  readonly promoted: boolean;
}

/**
 * F5 (R396): a run is PROMOTED only when its evaluation stage passed. `artifactRef` alone is not a promotion: it is
 * "the immutable artifact frozen out of dev" and is set on an evaluation failure too (pipeline.ts:84-85, :652-657).
 */
function evaluationPassed(stages: PipelineResult['stages']): boolean {
  return stages.some((s) => s.stage === 'evaluation' && s.status === 'passed');
}

/** The promoted artifact: a real ref AND a promotion; null otherwise. The one success rule of `eval`. */
function promotedRef(r: PipelineEnd): string | null {
  const ref = typeof r.artifactRef === 'string' && r.artifactRef !== '' ? r.artifactRef : null;
  return r.promoted ? ref : null;
}

/** The last line of `eval`: the promotion, or the frozen artifact and why it was not promoted. */
function pipelineEndLine(r: PipelineEnd): string {
  const promoted = promotedRef(r);
  if (promoted !== null) return `promoted to test as ${promoted}`;
  const ref = typeof r.artifactRef === 'string' && r.artifactRef !== '' ? r.artifactRef : null;
  const why = r.stages.find((s) => s.stage === 'evaluation' && s.status !== 'passed')?.detail ?? '';
  const reason = why === '' ? '' : `: ${why}`;
  return ref === null ? `not promoted${reason}` : `frozen as ${ref}; not promoted${reason}`;
}

/**
 * F5 (R396): a 202 means the platform runs the pipeline in the background and writes its stages and end on the
 * branch (pipeline.ts record). Read the branch again until no stage is running; null when the wait runs out.
 */
async function awaitBackgroundPipeline(
  io: CliIo,
  api: ApiClient,
  agent: string,
  branchId: string
): Promise<PipelineEnd | null> {
  const sleep = io.sleep ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)));
  for (let waited = 0; waited <= PIPELINE_WAIT_MS; waited += PIPELINE_POLL_MS) {
    await sleep(PIPELINE_POLL_MS);
    const b = (await api.codeBranches(agent)).find((x) => x.branchId === branchId);
    const stages = b?.pipeline ?? [];
    if (b !== undefined && stages.length > 0 && !stages.some((s) => s.status === 'running')) {
      // The branch says what the run ended as (pipeline.ts record): promoted only when its status is.
      return { artifactRef: b.artifactRef ?? null, stages, promoted: b.status === 'promoted' };
    }
  }
  return null;
}

/** Run one command. Returns the process exit code; every failure is a message, never a stack. */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        dir: { type: 'string' },
        agent: { type: 'string' },
        branch: { type: 'string' },
        yes: { type: 'boolean' },
      },
    });
  } catch (e) {
    io.err(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  const [command, ...rest] = parsed.positionals;
  const v = parsed.values as { dir?: string; agent?: string; branch?: string; yes?: boolean };
  const dir = resolve(io.cwd, v.dir ?? '.');
  try {
    switch (command) {
      case 'scaffold':
        return await scaffold(io, rest);
      case 'build':
        return await build(io, dir);
      case 'test':
        return await test(io, dir);
      case 'deploy':
        return await deploy(io, dir, v.agent);
      case 'eval':
        return await evaluate(io, v.agent, v.branch, v.yes === true);
      default:
        io.err(USAGE);
        return 2;
    }
  } catch (e) {
    if (e instanceof ApiError) {
      io.err(`refused: ${e.message}`);
      const problems = e.details['problems'];
      if (Array.isArray(problems)) {
        for (const p of problems as { file: string; message: string }[]) {
          io.err(`  ${p.file}: ${p.message}`);
        }
      }
      return 1;
    }
    io.err((e as Error).message);
    return 1;
  }
}
