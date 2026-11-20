import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { QuoteGuard, type QuoteDeps } from './quote-guard.js';
import { McpServer, type CliRun } from './server.js';
import { connect, ok, startMockPlatform, type MockPlatform } from './test-fixtures/harness.js';
import type { ToolSpec } from './tool-registry.js';

/** T3.2.2 AC3 - a paid tool without a valid quote id is refused; nothing paid runs blind. */

const PAID: ToolSpec = {
  name: 'revition_agents_test',
  commandId: 'agents:test',
  description: 'paid',
  inputSchema: { type: 'object', properties: { id: { type: 'string' }, quoteId: { type: 'string' } }, required: ['id', 'quoteId'], additionalProperties: false },
  mutates: false,
  paid: true,
  argNames: ['id'],
  booleanFlags: new Set(),
  multipleFlags: new Set(),
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
};

function fixture(): { server: McpServer; ran: (readonly string[])[]; setQuote: (id: string) => void } {
  let current = 'tq_1';
  const deps: QuoteDeps = { get: async () => ({ quoteId: current, modelCalls: 2 }), dryRun: async () => null };
  const ran: (readonly string[])[] = [];
  const runCli = async (argv: readonly string[], opts: { readonly confirm: boolean }): Promise<CliRun> => {
    ran.push(opts.confirm ? [...argv, '--yes'] : argv);
    return { code: 0, envelope: { ok: true, data: { report: 'r' } }, stderr: '' };
  };
  return { server: new McpServer({ tools: [PAID], runCli, quotes: new QuoteGuard(deps), serverVersion: '0.0.0' }), ran, setQuote: (id) => (current = id) };
}

async function call(s: McpServer, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; structuredContent?: Record<string, unknown> }> {
  const r = (await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })) as { result: { isError: boolean; structuredContent?: Record<string, unknown> } };
  return r.result;
}

describe('T3.2.2 the quote guard', () => {
  it('[CLI-T3.2.2-AC3] a paid call with no quote id, or an id this session did not issue, is refused and nothing runs', async () => {
    const f = fixture();
    const none = await call(f.server, 'revition_agents_test', { id: 'dep_1' });
    assert.equal(none.isError, true);
    assert.match(String(none.structuredContent?.['error']), /revition_quote/);
    const made = await call(f.server, 'revition_agents_test', { id: 'dep_1', quoteId: 'tq_1' });
    assert.equal(made.isError, true, 'the right id, but never issued by revition_quote');
    assert.equal(f.ran.length, 0);
  });

  it('[CLI-T3.2.2-AC3] quote first, then the paid call with that id runs once (confirmed); the id is used up', async () => {
    const f = fixture();
    const q = await call(f.server, 'revition_quote', { tool: 'revition_agents_test', arguments: { id: 'dep_1' } });
    assert.equal(q.isError, false);
    assert.equal(q.structuredContent?.['quoteId'], 'tq_1');
    assert.equal((await call(f.server, 'revition_agents_test', { id: 'dep_1', quoteId: 'tq_1' })).isError, false);
    assert.deepEqual(f.ran, [['agents', 'test', 'dep_1', '--yes']]);
    assert.equal((await call(f.server, 'revition_agents_test', { id: 'dep_1', quoteId: 'tq_1' })).isError, true, 'a quote is used once');
    assert.equal(f.ran.length, 1);
  });

  it('[CLI-T3.2.2-AC3] a quote for other arguments, or a quote that changed since, is refused (with the fresh quote)', async () => {
    const f = fixture();
    await call(f.server, 'revition_quote', { tool: 'revition_agents_test', arguments: { id: 'dep_1' } });
    assert.equal((await call(f.server, 'revition_agents_test', { id: 'dep_2', quoteId: 'tq_1' })).isError, true);
    f.setQuote('tq_2');
    const stale = await call(f.server, 'revition_agents_test', { id: 'dep_1', quoteId: 'tq_1' });
    assert.equal(stale.isError, true);
    assert.equal((stale.structuredContent?.['freshQuote'] as { quoteId: string }).quoteId, 'tq_2');
    assert.equal(f.ran.length, 0);
    assert.equal((await call(f.server, 'revition_agents_test', { id: 'dep_1', quoteId: 'tq_2' })).isError, false, 'the fresh quote, once reviewed');
    assert.equal(f.ran.length, 1);
  });
});

describe('T3.2.2 the quote guard through the real `revition mcp serve`', () => {
  let mock: MockPlatform;
  before(async () => {
    mock = await startMockPlatform((method, path) => {
      if (method === 'GET' && path === '/deployments/dep_1/tests/quote') return ok({ quoteId: 'tq_abc', draftVersion: 3, modelCalls: 2, freeCases: 1, available: true });
      if (method === 'POST' && path === '/deployments/dep_1/tests/run') return ok({ draftVersion: 3, results: [], regressionCount: 0, allPassed: true });
      return null;
    });
  });
  after(() => mock.close());

  it('[CLI-T3.2.2-AC3] no quote id: refused and the platform sees no run; quote -> run sends that quote id once', async () => {
    const s = await connect(mock.host);
    try {
      const refused = await s.client.callTool({ name: 'revition_agents_test', arguments: { id: 'dep_1' } });
      assert.equal(refused.isError, true);
      const forged = await s.client.callTool({ name: 'revition_agents_test', arguments: { id: 'dep_1', quoteId: 'tq_abc' } });
      assert.equal(forged.isError, true);
      assert.equal(mock.log.filter((r) => r.method === 'POST').length, 0, 'no paid call reached the platform');

      const q = await s.client.callTool({ name: 'revition_quote', arguments: { tool: 'revition_agents_test', arguments: { id: 'dep_1' } } });
      assert.equal((q.structuredContent as { quoteId: string }).quoteId, 'tq_abc');
      const ran = await s.client.callTool({ name: 'revition_agents_test', arguments: { id: 'dep_1', quoteId: 'tq_abc' } });
      assert.equal(ran.isError, false, JSON.stringify(ran));
      assert.equal((ran.structuredContent as { command: string; ok: boolean }).command, 'agents:test');
      const posts = mock.log.filter((r) => r.method === 'POST');
      assert.deepEqual(posts.map((r) => [r.path, r.body]), [['/deployments/dep_1/tests/run', { quoteId: 'tq_abc' }]]);
    } finally {
      await s.close();
    }
  });
});
