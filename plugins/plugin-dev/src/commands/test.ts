import { watch } from 'node:fs';
import { resolve } from 'node:path';

import { Flags } from '@oclif/core';
import { EXIT, RevitionCliError, RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { localChecks, manifestProblems, sourcePath, testsPath } from '../checks/local-checks.js';
import { SDK_VERSION } from '../local/fixture-sdk.js';
import { runLocally, type LocalCapability } from '../local/local-run.js';
import { readProjectDir } from '../project/read-project.js';

export const TEST_SCHEMA_ID = 'revition.test.v1';
const LOCAL_TIMEOUT_MS = 10_000;

export interface TestCase {
  readonly capability: string;
  readonly name: string;
  readonly passed: boolean;
  readonly output?: unknown;
  readonly expected: unknown;
  readonly message?: string;
  readonly networkAttempt: boolean;
  readonly logs: readonly string[];
}

export interface TestOut {
  readonly schemaId: typeof TEST_SCHEMA_ID;
  readonly dir: string;
  readonly sdkVersion: string;
  readonly passed: number;
  readonly failed: number;
  readonly cases: readonly TestCase[];
}

type Files = Readonly<Record<string, string>>;

/** Canonical JSON (sorted keys): the legacy `test`'s comparison of a result with its expectation. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** fixtures.json: an object of SDK call name to result (absent = no fixtures). */
export function fixturesOf(files: Files): Readonly<Record<string, unknown>> {
  const raw = files['fixtures.json'];
  if (raw === undefined) return {};
  const v = JSON.parse(raw) as unknown;
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new RevitionCliError({ code: 'TEST_FIXTURES_INVALID', message: 'fixtures.json is an object of SDK call name to result' }, EXIT.usage);
  }
  return v as Record<string, unknown>;
}

/** What each capability is granted: its own declared `sdkPermissions` (the platform's `grantedSdkPermissions`). */
function grantsOf(files: Files): Readonly<Record<string, readonly string[]>> {
  const caps = (JSON.parse(files['revition.json'] ?? '{}') as { capabilities?: unknown }).capabilities;
  const out: Record<string, readonly string[]> = {};
  for (const c of Array.isArray(caps) ? caps : []) {
    const o = (c ?? {}) as { id?: unknown; sdkPermissions?: unknown };
    if (typeof o.id === 'string') {
      out[o.id] = Array.isArray(o.sdkPermissions) ? o.sdkPermissions.filter((p): p is string => typeof p === 'string') : [];
    }
  }
  return out;
}

/** Every capability's tests, run here against the fixture SDK with the network blocked. No server, no credential. */
export async function runProjectTests(dir: string, filter: string | null): Promise<TestOut> {
  const files = readProjectDir(dir);
  const problems = localChecks(files);
  if (problems.length > 0) {
    throw new RevitionCliError(
      { code: 'TEST_PROJECT_INVALID', message: `The project has problems: ${problems.map((p) => `${p.file}: ${p.message}`).join('; ')}`, hint: 'Run `revition build` for the full list.' },
      EXIT.usage
    );
  }
  const fixtures = fixturesOf(files);
  const grants = grantsOf(files);
  const cases: TestCase[] = [];
  for (const c of manifestProblems(files).capabilities) {
    const cap: LocalCapability = { language: c.language as LocalCapability['language'], source: files[sourcePath(c)] ?? '', entrypoint: c.entrypoint };
    const tests = JSON.parse(files[testsPath(c.id)] ?? '[]') as Array<{ name: string; input: unknown; expect: unknown }>;
    for (const t of tests.filter((x) => filter === null || x.name.includes(filter))) {
      const r = await runLocally(cap, t.input, { fixtures, granted: grants[c.id] ?? [] }, { timeoutMs: LOCAL_TIMEOUT_MS });
      const passed = r.ok && canonical(r.output) === canonical(t.expect);
      cases.push({
        capability: c.id,
        name: t.name,
        passed,
        ...(r.ok ? { output: r.output } : {}),
        expected: t.expect,
        ...(r.message !== undefined ? { message: r.message } : {}),
        networkAttempt: r.networkAttempt,
        logs: r.logs,
      });
    }
  }
  const failed = cases.filter((x) => !x.passed).length;
  return { schemaId: TEST_SCHEMA_ID, dir, sdkVersion: SDK_VERSION, passed: cases.length - failed, failed, cases };
}

/** The legacy `test`'s lines (PASS / FAIL per case, the reason, the logs, the summary). */
export function renderTests(o: TestOut): string {
  const lines: string[] = [];
  for (const c of o.cases) {
    lines.push(`${c.passed ? 'PASS' : 'FAIL'} ${c.capability}: ${c.name}`);
    if (c.passed) continue;
    if (c.networkAttempt) lines.push('  the test tried to reach the network: `revition test` runs offline; answer SDK calls from fixtures.json');
    lines.push(c.message === undefined ? `  returned ${canonical(c.output)}, expected ${canonical(c.expected)}` : `  ${c.message}`);
    for (const l of c.logs) lines.push(`  | ${l}`);
  }
  lines.push(o.failed === 0 ? 'all tests passed locally' : `${o.failed} test(s) failed`);
  return `${lines.join('\n')}\n`;
}

export default class Test extends RevitionCommand<TestOut> {
  static override summary = "Run the project's tests here: the stubbed SDK from fixtures.json, no network, no sign-in.";
  static override examples = ['revition test', 'revition test --filter refund --json', 'revition test --watch'];
  static meta: CommandMeta = {
    id: 'test',
    summary: Test.summary,
    examples: Test.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: TEST_SCHEMA_ID,
    stability: 'stable',
  };
  static override flags = {
    dir: Flags.string({ description: 'The project directory (default: the current directory).' }),
    filter: Flags.string({ description: 'Run only the tests whose name contains this text.' }),
    watch: Flags.boolean({ description: 'Re-run on every change until Ctrl-C.' }),
  };

  protected async run2(ctx: CommandContext): Promise<TestOut> {
    const dir = resolve(process.cwd(), typeof ctx.commandFlags['dir'] === 'string' ? ctx.commandFlags['dir'] : '.');
    const filter = typeof ctx.commandFlags['filter'] === 'string' ? ctx.commandFlags['filter'] : null;
    const first = await runProjectTests(dir, filter);
    if (ctx.commandFlags['watch'] === true) {
      // AC3: re-run on change. Each run prints to stderr; Ctrl-C ends it (exit 11, the base command's cancel).
      ctx.io.err(renderTests(first));
      await new Promise<never>(() => {
        let timer: NodeJS.Timeout | null = null;
        watch(dir, { recursive: true }, (_e, name) => {
          if (name !== null && String(name).startsWith('.revition')) return;
          if (timer !== null) clearTimeout(timer);
          timer = setTimeout(() => {
            void runProjectTests(dir, filter).then(
              (o) => ctx.io.err(`--- re-run ---\n${renderTests(o)}`),
              (e: unknown) => ctx.io.err(`--- re-run ---\n${e instanceof Error ? e.message : String(e)}\n`)
            );
          }, 200);
        });
      });
    }
    if (first.failed > 0) ctx.setExitCode?.(EXIT.general);
    return first;
  }

  protected override human(o: TestOut): HumanView {
    return { text: renderTests(o) };
  }
}
