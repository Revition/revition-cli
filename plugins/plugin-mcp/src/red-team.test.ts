import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { Config } from '@oclif/core';

import { PAID_QUOTE_SPECS, QuoteGuard } from './quote-guard.js';
import { McpServer, type CliRun } from './server.js';
import { CLI_ROOT } from './test-fixtures/harness.js';
import { buildTools, type LoadedCommand } from './tool-registry.js';

/**
 * T3.4.2 - red team (MCP). What a prompt-injected MCP client would try: call publish / approve / promote, smuggle a
 * confirmation flag through an argument, spend without a quote, use a local command. The real registry (every loaded
 * command, --allow-write on) behind the real server; the CLI runner only records what WOULD run.
 */
let server: McpServer;
const ran: (readonly string[])[] = [];

before(async () => {
  const commands = (await Config.load(CLI_ROOT)).commands as unknown as LoadedCommand[];
  const tools = buildTools(commands, { allowWrite: true, quotable: new Set(Object.keys(PAID_QUOTE_SPECS)) });
  const runCli = async (argv: readonly string[]): Promise<CliRun> => {
    ran.push(argv);
    return { code: 0, envelope: { ok: true }, stderr: '' };
  };
  server = new McpServer({ tools, runCli, quotes: new QuoteGuard({ get: async () => ({ quoteId: 'q' }), dryRun: async () => ({ quote: { quoteId: 'q' } }) }), serverVersion: '0' });
});

async function call(name: string, args: Record<string, unknown>): Promise<{ error?: { code: number }; result?: { isError: boolean } }> {
  return (await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })) as { error?: { code: number }; result?: { isError: boolean } };
}

describe('T3.4.2 red team: MCP', () => {
  it('[CLI-T3.4.2-AC1] publish / approve / promote / go-live / rollback do not exist as tools, even with --allow-write', async () => {
    for (const name of ['revition_publish', 'revition_agents_publish', 'revition_submissions_publish', 'revition_branches_approve', 'revition_branches_merge', 'revition_agents_promote', 'revition_versions_rollback', 'revition_go_live']) {
      assert.equal((await call(name, { id: 'x' })).error?.code, -32602, name);
    }
    assert.equal(ran.length, 0);
  });

  it('[CLI-T3.4.2-AC1] a typed-confirm command, a local command and a smuggled --yes are refused; a paid call without a quote is refused', async () => {
    ran.length = 0;
    assert.equal((await call('revition_apps_keys_revoke', { appId: 'a', keyId: 'k' })).error?.code, -32602);
    assert.equal((await call('revition_config_set', { key: 'host', value: 'evil' })).error?.code, -32602);
    assert.equal((await call('revition_agents_pull', { id: 'x' })).error?.code, -32602);
    assert.equal((await call('revition_apps_view', { id: '--yes' })).result?.isError, true);
    assert.equal((await call('revition_apps_view', { id: 'a', yes: true })).result?.isError, true);
    assert.equal((await call('revition_agents_test', { id: 'dep_1' })).result?.isError, true);
    assert.equal((await call('revition_agents_test', { id: 'dep_1', quoteId: 'q' })).result?.isError, true, 'q was never issued in this session');
    assert.equal(ran.length, 0, 'nothing ran');
  });
});
