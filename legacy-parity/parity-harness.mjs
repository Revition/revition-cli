// T0.1.3 AC4 (REVITION-CLI-PLAN.md:625): run the 5 legacy commands against a mock API and record every HTTP request.
// The SAME harness records "before" (the platform monorepo's packages/revition-cli) and checks "after" (legacy/ here).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const API = 'https://api.mock.invalid/api/v1';
export const TOKEN = 'parity-test-token';

/** The mock API: one canned answer per route the legacy client calls (legacy/src/client.ts). */
function answer(method, path) {
  if (method === 'GET' && path.startsWith('/foundry/dev/starters/')) {
    return { title: 'Hello capability', files: { 'capability.ts': 'export default 1;\n', 'fixtures.json': '{}\n' } };
  }
  if (method === 'POST' && path === '/foundry/dev/authoring/check') {
    return { ok: true, problems: [], warnings: [], buildLogs: {}, project: { capabilities: [] }, granted: {} };
  }
  if (method === 'GET' && path === '/foundry/dev/docs/sdk') return { version: '1', namespaces: [] };
  if (method === 'POST' && /^\/foundry\/deployments\/[^/]+\/code-branches$/.test(path)) {
    return { branch: 'cli/parity', branchId: 'br_parity', files: ['capability.ts'], permissionDiff: [] };
  }
  if (method === 'GET' && path.endsWith('/pipeline-quote')) return { quoteId: 'q_parity', sandboxRuns: 1, limits: {} };
  if (method === 'POST' && path.endsWith('/pipeline')) {
    return { artifactRef: 'art_parity', stages: [{ stage: 'evaluation', status: 'passed', detail: '' }] };
  }
  return null;
}

function recordingFetch(log) {
  return async (url, init = {}) => {
    const u = new URL(String(url));
    log.push({
      method: init.method ?? 'GET',
      url: String(url),
      headers: init.headers ?? {},
      body: init.body ?? null,
    });
    const body = answer(init.method ?? 'GET', u.pathname.replace(/^\/api\/v1/, ''));
    const { Response } = globalThis;
    return body === null
      ? new Response(JSON.stringify({ error: { code: 'NOT_MOCKED' } }), { status: 404 })
      : new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

/** The 5 legacy commands, in a fresh temp dir. Returns { command -> { exit, requests } }. */
export async function runAllCommands(runCli) {
  const cwd = mkdtempSync(join(tmpdir(), 'legacy-parity-'));
  const sequence = [
    ['scaffold', ['scaffold', 'hello', 'proj']],
    ['build', ['build', '--dir', 'proj']],
    ['test', ['test', '--dir', 'proj']],
    ['deploy', ['deploy', '--agent', 'ag_parity', '--dir', 'proj']],
    ['eval', ['eval', '--agent', 'ag_parity', '--branch', 'br_parity', '--yes']],
  ];
  const result = {};
  try {
    for (const [name, argv] of sequence) {
      const requests = [];
      const exit = await runCli(argv, {
        cwd,
        env: { REVITION_TOKEN: TOKEN, REVITION_API_URL: API },
        out: () => {},
        err: () => {},
        fetch: recordingFetch(requests),
        sleep: async () => {},
      });
      result[name] = { exit, requests };
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
  return result;
}
