import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { Config } from '@oclif/core';

import { PAID_QUOTE_SPECS } from './quote-guard.js';
import { CLI_ROOT, connect, startMockPlatform, type MockPlatform } from './test-fixtures/harness.js';
import { buildTools, exclusionReason, LOCAL_COMMANDS, toolArgv, toolName, type LoadedCommand, type ToolSpec } from './tool-registry.js';

/** T3.2.2 AC1 / AC2 - which commands become MCP tools: over the real command registry and through the real server. */
const quotable = new Set(Object.keys(PAID_QUOTE_SPECS));
const D9 = /publish|approve|reject|merge|promote|go_?live|release|rollback/;

let commands: LoadedCommand[] = [];
const metaOf = (id: string): LoadedCommand['meta'] => commands.find((c) => c.id === id)?.meta;

before(async () => {
  commands = (await Config.load(CLI_ROOT)).commands as unknown as LoadedCommand[];
});

describe('T3.2.2 the tool registry over the real commands', () => {
  it('[CLI-T3.2.2-AC1] without --allow-write no mutating command is a tool; the read commands are', () => {
    const tools = buildTools(commands, { allowWrite: false, quotable });
    assert.ok(tools.length > 20, `only ${tools.length} tools`);
    for (const t of tools) assert.equal(metaOf(t.commandId)?.mutates, false, `${t.name} mutates`);
    const names = tools.map((t) => t.name);
    for (const n of ['revition_apps_list', 'revition_logs', 'revition_docs', 'revition_agents_list', 'revition_build']) assert.ok(names.includes(n), n);
    for (const n of ['revition_apps_create', 'revition_secrets_set', 'revition_agents_push', 'revition_deploy', 'revition_submit']) assert.ok(!names.includes(n), n);
    assert.ok(tools.every((t) => !t.annotations.destructiveHint));
  });

  it('[CLI-T3.2.2-AC2] typed-confirm commands are never tools, even with --allow-write; mutating ones are with it', () => {
    const typed = commands.filter((c) => c.meta?.confirm === 'typed').map((c) => c.id);
    assert.ok(typed.includes('apps:keys:revoke'), 'the fixture case: key revoke is typed');
    for (const allowWrite of [false, true]) {
      const names = buildTools(commands, { allowWrite, quotable }).map((t) => t.name);
      for (const id of typed) assert.ok(!names.includes(toolName(id)), `${id} listed (allowWrite=${String(allowWrite)})`);
    }
    const write = buildTools(commands, { allowWrite: true, quotable }).map((t) => t.name);
    for (const n of ['revition_apps_create', 'revition_secrets_set', 'revition_agents_push']) assert.ok(write.includes(n), n);
    assert.match(exclusionReason({ id: 'apps:keys:revoke', meta: metaOf('apps:keys:revoke') }, { allowWrite: true, quotable }) ?? '', /typed/);
  });

  it('[CLI-T3.2.2-AC2] no release action exists to list (D9): no command id and no tool in either mode names one', () => {
    for (const c of commands) assert.doesNotMatch(c.id.replace(/[:-]/g, '_'), D9, c.id);
    for (const allowWrite of [false, true]) for (const t of buildTools(commands, { allowWrite, quotable })) assert.doesNotMatch(t.name, D9, t.name);
  });

  it('no local command (files, config, credentials, a local server) is a tool; meta.mcp=false and --tools are honoured', () => {
    for (const allowWrite of [false, true]) {
      const ids = buildTools(commands, { allowWrite, quotable }).map((t) => t.commandId);
      for (const id of LOCAL_COMMANDS) assert.ok(!ids.includes(id), id);
    }
    const apps = commands.find((c) => c.id === 'apps:list');
    assert.ok(apps?.meta !== undefined);
    assert.match(exclusionReason({ ...apps, meta: { ...apps.meta, mcp: false } }, { allowWrite: false, quotable }) ?? '', /meta\.mcp/);
    const only = buildTools(commands, { allowWrite: false, quotable, tools: 'revition_apps_*,logs' }).map((t) => t.name);
    assert.deepEqual(only, ['revition_apps_keys_list', 'revition_apps_list', 'revition_apps_listing', 'revition_apps_view', 'revition_logs']);
  });

  it('a tool call becomes exact CLI arguments; unknown arguments and a "-" positional are refused', () => {
    const tools = buildTools(commands, { allowWrite: false, quotable });
    const view = tools.find((t) => t.name === 'revition_apps_view') as ToolSpec;
    assert.deepEqual(toolArgv(view, { id: 'app_1' }), ['apps', 'view', 'app_1']);
    assert.throws(() => toolArgv(view, { id: '--yes' }), /must not start/);
    assert.throws(() => toolArgv(view, { id: 'a', yes: true }), /Unknown argument "yes"/);
    assert.throws(() => toolArgv(view, {}), /Missing argument/);
    const logs = tools.find((t) => t.name === 'revition_logs') as ToolSpec;
    assert.ok(!('follow' in logs.inputSchema.properties), 'a never-ending stream is not a tool input');
  });
});

describe('T3.2.2 tools/list through the real `revition mcp serve`', () => {
  let mock: MockPlatform;
  before(async () => {
    mock = await startMockPlatform(() => null);
  });
  after(() => mock.close());

  it('[CLI-T3.2.2-AC1] [CLI-T3.2.2-AC2] the default server lists no mutating tool; --allow-write adds them but never key revoke', async () => {
    const ro = await connect(mock.host);
    try {
      const { tools } = await ro.client.listTools();
      const names = tools.map((t) => t.name);
      assert.ok(names.includes('revition_apps_list'));
      for (const t of tools) assert.notEqual(t.annotations?.destructiveHint, true, t.name);
      for (const n of ['revition_apps_create', 'revition_apps_keys_revoke', 'revition_apps_keys_rotate']) assert.ok(!names.includes(n), n);
    } finally {
      await ro.close();
    }
    const rw = await connect(mock.host, ['--allow-write']);
    try {
      const names = (await rw.client.listTools()).tools.map((t) => t.name);
      assert.ok(names.includes('revition_apps_create'));
      assert.ok(names.includes('revition_apps_keys_rotate'));
      assert.ok(!names.includes('revition_apps_keys_revoke'));
      for (const n of names) assert.doesNotMatch(n, D9, n);
    } finally {
      await rw.close();
    }
    assert.equal(mock.log.length, 0, 'listing tools calls nothing on the platform');
  });
});
