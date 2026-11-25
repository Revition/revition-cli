import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { definitionText } from './format.js';
import { dirs, ok, runCli, startMockPlatform, type MockPlatform } from './test-fixtures/mock-platform.js';

/**
 * T3.2.1 AC1 - the agents commands the other suites do not run with --json, each run here with --json through the real
 * CLI against one fixture platform; `runCli` validates each document against the command's PUBLISHED schema.
 */
const DRAFT = { version: 2, config: { instructions: 'x' }, sections: { governance: { autonomy: 'draft' } } };
const REPORT = { draftVersion: 2, results: [{ caseId: 'c1', type: 'draft_run', status: 'completed', passed: true }], regressionCount: 0, allPassed: true };

function platform(): Promise<MockPlatform> {
  return startMockPlatform((method, path) => {
    const routes: Record<string, unknown> = {
      'GET /deployments/dep_1': { deploymentId: 'dep_1', name: 'Support', status: 'live' },
      'GET /deployments/dep_1/draft': { draft: DRAFT },
      'PUT /deployments/dep_1/draft': { draft: { ...DRAFT, version: 3 }, changed: true },
      'GET /deployments/dep_1/draft/diff': { changedSections: [], added: [], removed: [], hasUnsavedChanges: false },
      'POST /agent-templates/scaffold': { deploymentId: 'dep_9', templateId: 't', fromTemplate: 'blank', compatible: true, flags: [], migrationPath: null },
      'PUT /deployments/dep_9/draft': { draft: { ...DRAFT, version: 1 }, changed: true },
      'GET /agent-templates': { templates: [{ templateAppId: 'blank', name: 'Blank', useCase: 'any' }] },
      'GET /deployments/dep_1/tests/quote': { quoteId: 'q', draftVersion: 2, modelCalls: 0, freeCases: 1, available: true, billedEstimateUsd: null },
      'POST /deployments/dep_1/tests/run': REPORT,
      'GET /deployments/dep_1/tests/report': { report: REPORT, run: { status: 'finished', done: 1, total: 1 }, history: [] },
      'GET /deployments/dep_1/environments': { managed: null, environments: [{ env: 'dev', provisioned: true, artifactRef: 'a', pending: null }] },
      'GET /deployments/dep_1/intelligence/traces': { items: [{ executionId: 'e1', taskId: null, workTitle: null, at: 'x', status: 'ok', failed: false }], nextCursor: null },
    };
    const body = routes[`${method} ${path}`];
    return body === undefined ? null : ok(body);
  });
}

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agents-conf-'));
  mkdirSync(join(dir, 'agents'));
  writeFileSync(join(dir, 'agents', 'support.agent.yaml'), definitionText({ schemaVersion: 1, agent: { id: 'dep_1', name: 'Support' }, config: { config: { instructions: 'changed' }, sections: DRAFT.sections } }));
  writeFileSync(join(dir, 'agents', 'new.agent.yaml'), definitionText({ schemaVersion: 1, agent: { id: null, name: 'New' }, config: { config: {}, sections: {} } }));
  return dir;
}

const CASES: readonly (readonly string[])[] = [
  ['agents', 'validate', 'agents/support.agent.yaml'],
  ['agents', 'templates'],
  ['agents', 'pull', 'dep_1', '-o', 'pulled.agent.yaml'],
  ['agents', 'diff', 'agents/support.agent.yaml'],
  ['agents', 'push', 'agents/support.agent.yaml', '--yes'],
  ['agents', 'create', 'agents/new.agent.yaml', '--yes'],
  ['agents', 'test', 'dep_1', '--yes'],
  ['agents', 'status', 'dep_1'],
  ['agents', 'traces', 'dep_1'],
];

describe('T3.2.1 AC1 - every remaining agents command: its --json output conforms to the published schema', () => {
  for (const argv of CASES) {
    it(`[CLI-T3.2.1-AC1] ${argv.slice(0, 2).join(' ')} --json`, async () => {
      const p = await platform();
      try {
        const r = await runCli([...argv, '--json'], { cwd: await project(), host: p.host, env: await dirs() });
        assert.equal(r.code, 0, r.stdout + r.stderr);
        assert.equal((JSON.parse(r.stdout) as { ok: boolean }).ok, true);
      } finally {
        p.close();
      }
    });
  }
});
