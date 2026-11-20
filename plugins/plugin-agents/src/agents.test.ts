import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { canonical, definitionText, diffBySection, parseDefinitionText, type AgentDefinition } from './format.js';
import { secretFindings, validateLocal } from './validate.js';
import { dirs, err, ok, PAT, runCli, startMockPlatform, type MockPlatform } from './test-fixtures/mock-platform.js';

const CONFIG = { systemPrompt: 'You are the support agent.', instructions: 'Answer from the returns policy.\nEscalate refunds over 100.', skills: ['skill_refund_policy'], tools: ['atlas:orders.read'] };
const SECTIONS = { governance: { autonomy: 'draft' }, operating_hours: { timezone: 'UTC' } };
const DEF: AgentDefinition = { schemaVersion: 1, agent: { id: 'dep_1', name: 'Support Agent' }, config: { config: CONFIG, sections: SECTIONS } };

describe('T3.1.1 the definition file and agents validate (local)', () => {
  it('[CLI-T3.1.1-AC2] a file with an rvt_ token or an API-key-looking literal fails; the finding names the line, never the value', () => {
    const clean = definitionText(DEF);
    assert.equal(validateLocal(clean).ok, true);
    for (const leak of [`  token: ${PAT}`, '  apiKey: "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx"', '  password: CorrectHorseBatteryStaple99', '  aws: AKIAABCDEFGHIJKLMNOP']) {
      const text = clean.replace('  systemPrompt:', `${leak}\n  systemPrompt:`);
      const r = validateLocal(text);
      assert.equal(r.ok, false, leak);
      const f = r.problems.find((p) => p.line !== null);
      assert.ok(f !== undefined, leak);
      assert.match(f.message, /secrets are never inline/);
      assert.doesNotMatch(JSON.stringify(r.problems), /rvt_P|AbCdEfGh|CorrectHorse|AKIAABCD/);
    }
    assert.deepEqual(secretFindings('instructions: use the SUPPORT_EMAIL org variable'), []);
  });

  it("validation follows the platform's pinned schema; an unknown config field (a newer platform's) is a warning and kept", () => {
    const extra = validateLocal(definitionText({ ...DEF, agent: { ...DEF.agent, role: 'worker' } as never }));
    assert.equal(extra.ok, false);
    assert.match(JSON.stringify(extra.problems), /\/agent/);
    const newer = { ...DEF, config: { ...DEF.config, config: { ...CONFIG, futureField: { x: 1 } } } };
    const r = validateLocal(definitionText(newer));
    assert.equal(r.ok, true);
    assert.deepEqual(r.warnings.map((w) => w.path), ['/config/config/futureField']);
    assert.deepEqual((parseDefinitionText(definitionText(newer)) as AgentDefinition).config.config, newer.config.config);
  });

  it('[CLI-T3.1.3-AC3] the diff is per section: config fields and sections are each one unit', () => {
    const edited = { config: { ...CONFIG, instructions: 'New text.' }, sections: { governance: SECTIONS.governance, triggers: { cron: '0 9 * * *' } } };
    assert.deepEqual(diffBySection(DEF.config, edited), { added: ['sections.triggers'], removed: ['sections.operating_hours'], changed: ['config.instructions'] });
  });
});

interface State {
  version: number;
  config: Record<string, unknown>;
  sections: Record<string, unknown>;
  live: Record<string, unknown>;
}

function platform(state: Map<string, State>): Promise<MockPlatform> {
  return startMockPlatform((method, path, body) => {
    if (method === 'GET' && path === '/deployments') return ok({ items: [...state.keys()].map((id) => ({ deploymentId: id, name: 'Support Agent', status: 'live' })) });
    if (method === 'POST' && path === '/agent-templates/scaffold') {
      const id = `dep_${state.size + 1}`;
      state.set(id, { version: 0, config: {}, sections: {}, live: {} });
      return { status: 201, body: { deploymentId: id, templateId: (body as { templateAppId: string }).templateAppId, fromTemplate: 'blank', compatible: true, flags: [], migrationPath: null } };
    }
    const m = /^\/deployments\/([^/]+)(\/draft(?:\/diff|\/validate)?)?$/.exec(path);
    const s = m === null ? undefined : state.get(m[1] ?? '');
    if (m === null) return null;
    if (s === undefined) return err(404, 'AGENT_NOT_FOUND', 'no such agent');
    if (method === 'GET' && m[2] === undefined) return ok({ deploymentId: m[1], name: 'Support Agent', status: 'live' });
    if (method === 'GET' && m[2] === '/draft') return ok({ draft: { version: s.version, config: s.config, sections: s.sections } });
    if (method === 'PUT' && m[2] === '/draft') {
      const b = body as { config: Record<string, unknown>; sections: Record<string, unknown>; baseVersion?: number };
      if (b.baseVersion !== undefined && b.baseVersion !== s.version) return { status: 409, body: { error: { code: 'AGENT_DRAFT_CONFLICT', message: 'changed', currentVersion: s.version } } };
      s.version += 1;
      s.config = b.config;
      s.sections = b.sections;
      return ok({ draft: { version: s.version, config: s.config, sections: s.sections }, changed: true });
    }
    if (method === 'GET' && m[2] === '/draft/diff') {
      const changed = Object.keys(s.config).filter((k) => canonical(s.config[k]) !== canonical(s.live[k]));
      return ok({ changedSections: changed, added: [], removed: [], hasUnsavedChanges: changed.length > 0 });
    }
    if (method === 'POST' && m[2] === '/draft/validate') return ok({ valid: false, issues: ['tool atlas:missing.tool is not connected in this workspace'], diff: { changedSections: ['tools'], added: [], removed: [] } });
    return null;
  });
}

const world = (): Map<string, State> => new Map([['dep_1', { version: 3, config: { ...CONFIG }, sections: { ...SECTIONS }, live: { ...CONFIG } }]]);

describe('T3.1.3 agents pull / push / diff / create (through the real CLI)', () => {
  it('[CLI-T3.1.3-AC1] [CLI-T3.1.1-AC4] pull -> validate passes -> push with no change = "no changes", nothing sent', async () => {
    const p = await platform(world());
    try {
      const cwd = await mkdtemp(join(tmpdir(), 'agents-'));
      const env = await dirs();
      const pull = await runCli(['agents', 'pull', 'dep_1'], { cwd, host: p.host, env });
      assert.equal(pull.code, 0, pull.stderr);
      const file = join(cwd, 'agents', 'support-agent.agent.yaml');
      assert.match(readFileSync(file, 'utf8'), /instructions: \|-\n {6}Answer from the returns policy\./);
      const v = await runCli(['agents', 'validate', file], { cwd, host: p.host, env });
      assert.equal(v.code, 0, v.stdout + v.stderr);
      const push = await runCli(['agents', 'push', file, '--yes'], { cwd, host: p.host, env });
      assert.equal(push.code, 0, push.stderr);
      assert.match(push.stdout, /^No changes/);
      assert.equal(p.log.filter((l) => l.method === 'PUT').length, 0);
    } finally {
      p.close();
    }
  });

  it('[CLI-T3.1.3-AC2] a concurrent save: the push sends the pulled baseVersion and a 409 is exit 6 with a re-pull hint', async () => {
    const state = world();
    const p = await platform(state);
    try {
      const cwd = await mkdtemp(join(tmpdir(), 'agents-'));
      const env = await dirs();
      assert.equal((await runCli(['agents', 'pull', 'dep_1'], { cwd, host: p.host, env })).code, 0);
      const file = join(cwd, 'agents', 'support-agent.agent.yaml');
      writeFileSync(file, readFileSync(file, 'utf8').replace('Escalate refunds over 100.', 'Escalate refunds over 200.'));
      // Someone else saves in the portal meanwhile.
      const s = state.get('dep_1');
      if (s !== undefined) s.version = 4;
      const push = await runCli(['agents', 'push', file, '--yes', '--json'], { cwd, host: p.host, env });
      assert.equal(push.code, 6, push.stderr);
      const e = (JSON.parse(push.stdout) as { error: { code: string; hint: string } }).error;
      assert.equal(e.code, 'AGENT_DRAFT_CONFLICT');
      assert.match(e.hint, /revition agents pull dep_1/);
      assert.equal((p.log.find((l) => l.method === 'PUT')?.body as { baseVersion: number }).baseVersion, 3);
      assert.equal(state.get('dep_1')?.config['instructions'], CONFIG.instructions);
    } finally {
      p.close();
    }
  });

  it('push saves the DRAFT only, prints the draft vs live and the portal go-live hint; no publish call', async () => {
    const state = world();
    const p = await platform(state);
    try {
      const cwd = await mkdtemp(join(tmpdir(), 'agents-'));
      const env = await dirs();
      assert.equal((await runCli(['agents', 'pull', 'dep_1'], { cwd, host: p.host, env })).code, 0);
      const file = join(cwd, 'agents', 'support-agent.agent.yaml');
      writeFileSync(file, readFileSync(file, 'utf8').replace('Escalate refunds over 100.', 'Escalate refunds over 200.'));
      const diff = await runCli(['agents', 'diff', file], { cwd, host: p.host, env });
      assert.match(diff.stdout, /~ config\.instructions/);
      const push = await runCli(['agents', 'push', file, '--yes'], { cwd, host: p.host, env });
      assert.equal(push.code, 0, push.stderr);
      assert.match(push.stdout, /Saved the draft of dep_1 \(version 4\)/);
      assert.match(push.stdout, /Draft vs live: instructions/);
      assert.match(push.stdout, /revition agents open dep_1 --action publish/);
      assert.deepEqual(state.get('dep_1')?.live, CONFIG);
      assert.equal(p.log.some((l) => /publish|promote/.test(l.path)), false);
    } finally {
      p.close();
    }
  });

  it('pull keeps local edits unless --force; a deleted agent is exit 5', async () => {
    const p = await platform(world());
    try {
      const cwd = await mkdtemp(join(tmpdir(), 'agents-'));
      const env = await dirs();
      assert.equal((await runCli(['agents', 'pull', 'dep_1'], { cwd, host: p.host, env })).code, 0);
      const file = join(cwd, 'agents', 'support-agent.agent.yaml');
      writeFileSync(file, readFileSync(file, 'utf8').replace('Escalate', 'Always escalate'));
      const again = await runCli(['agents', 'pull', 'dep_1'], { cwd, host: p.host, env });
      assert.equal(again.code, 6);
      assert.match(readFileSync(file, 'utf8'), /Always escalate/);
      assert.equal((await runCli(['agents', 'pull', 'dep_1', '--force'], { cwd, host: p.host, env })).code, 0);
      assert.doesNotMatch(readFileSync(file, 'utf8'), /Always escalate/);
      assert.equal((await runCli(['agents', 'pull', 'dep_gone'], { cwd, host: p.host, env })).code, 5);
    } finally {
      p.close();
    }
  });

  it('[CLI-T3.1.3-AC5] agents create: a new agent (blank template) whose draft equals the file; live untouched; the file gets the id', async () => {
    const state = new Map<string, State>();
    const p = await platform(state);
    try {
      const cwd = await mkdtemp(join(tmpdir(), 'agents-'));
      mkdirSync(join(cwd, 'agents'));
      const file = join(cwd, 'agents', 'new.agent.yaml');
      writeFileSync(file, definitionText({ ...DEF, agent: { id: null, name: 'Support Agent' } }));
      const r = await runCli(['agents', 'create', file, '--yes'], { cwd, host: p.host, env: await dirs() });
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(p.log.find((l) => l.path === '/agent-templates/scaffold')?.body, { templateAppId: 'blank', name: 'Support Agent' });
      const made = state.get('dep_1');
      assert.deepEqual([made?.config, made?.sections, made?.live], [CONFIG, SECTIONS, {}]);
      assert.equal((parseDefinitionText(readFileSync(file, 'utf8')) as AgentDefinition).agent.id, 'dep_1');
    } finally {
      p.close();
    }
  });

  it('a large --json document reaches a pipe whole (406 agents, over 64 KB)', async () => {
    const many = new Map<string, State>(Array.from({ length: 406 }, (_v, i) => [`dep_${String(i).padStart(4, '0')}_${'x'.repeat(150)}`, { version: 1, config: {}, sections: {}, live: {} }]));
    const p = await platform(many);
    try {
      const r = await runCli(['agents', 'list', '--json'], { cwd: tmpdir(), host: p.host, env: await dirs() });
      assert.equal(r.code, 0, r.stderr);
      assert.ok(r.stdout.length > 65_536, `${r.stdout.length} bytes`);
      assert.equal((JSON.parse(r.stdout) as { data: { agents: unknown[] } }).data.agents.length, 406);
    } finally {
      p.close();
    }
  });

  it('validate --server returns the platform compatibility / permission diff', async () => {
    const p = await platform(world());
    try {
      const cwd = await mkdtemp(join(tmpdir(), 'agents-'));
      const file = join(cwd, 'support.agent.yaml');
      writeFileSync(file, definitionText(DEF));
      const r = await runCli(['agents', 'validate', file, '--server'], { cwd, host: p.host, env: await dirs() });
      assert.equal(r.code, 6);
      assert.match(r.stdout, /server: tool atlas:missing\.tool is not connected/);
      assert.match(r.stdout, /vs live: tools/);
    } finally {
      p.close();
    }
  });
});
