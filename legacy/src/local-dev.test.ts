/**
 * T2.11.5 AC4 — local-dev: the SAME SDK, stubbed ports, no prod data.
 *
 * Parity is checked against the platform's own modules (loaded from apps/api at test time, never bundled): the
 * permission each call needs, the grant rule, and the reference the CLI reads.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SdkReference } from './client';
import {
  isGranted,
  localDevPorts,
  paramNames,
  permissionsFor,
  serveLocalSdk,
  type LocalCall,
} from './local-dev';

const API = join(__dirname, '../../../apps/api/src/services/foundry');
const contract = require(join(API, 'contracts/extension-sdk')) as {
  SDK_CALLS: Record<string, (a: readonly unknown[]) => readonly string[]>;
};
const platformSdk = require(join(API, 'sdk/extension-sdk')) as {
  isGranted: (granted: readonly string[], p: string) => boolean;
};
const generated = require(join(API, 'devportal/docs/sdk-reference.generated')) as {
  SDK_REFERENCE: SdkReference;
};
const REF = generated.SDK_REFERENCE;

describe('the local SDK needs exactly what the platform needs, call by call', () => {
  it('every call in the published reference: the permissions equal the platform table for real arguments', () => {
    const calls = REF.namespaces.flatMap((n) => n.calls.map((c) => c.call));
    expect(calls.sort()).toEqual(Object.keys(contract.SDK_CALLS).sort());
    for (const call of calls) {
      const args = ['shopify', 'q', 'c'];
      expect([call, permissionsFor(REF, call, args)]).toEqual([
        call,
        contract.SDK_CALLS[call]!(args),
      ]);
    }
    expect(permissionsFor(REF, 'nope.call', [])).toBeNull();
  });

  it('parameter names survive generic and union types', () => {
    expect(
      paramNames('read(sourceId: string, query: string, cursor: string | null): Promise<DataPage>')
    ).toEqual(['sourceId', 'query', 'cursor']);
    expect(
      paramNames(
        'start(workflowId: string, input: Readonly<Record<string, unknown>>): Promise<{ readonly runId: string }>'
      )
    ).toEqual(['workflowId', 'input']);
    expect(paramNames('current(): Promise<RunContext>')).toEqual([]);
  });

  it('the grant rule is the platform’s, on every case', () => {
    const granted = ['source:*', 'effect:read', 'ai:complete', 'effect:*'];
    for (const p of [
      'source:shopify',
      'source:*',
      'effect:read',
      'effect:send',
      'ai:complete',
      'task:write',
      'nocolon',
    ]) {
      expect([p, isGranted(granted, p)]).toEqual([p, platformSdk.isGranted(granted, p)]);
    }
  });
});

describe('stubbed ports: fixtures only, secrets never, effects recorded', () => {
  const GRANTED = [
    'effect:read',
    'source:shopify',
    'secret:API_KEY',
    'effect:send',
    'conversation:reply',
  ];

  it('a granted call is answered from its fixture; one without a fixture is refused with the fix', () => {
    const log: LocalCall[] = [];
    const sdk = localDevPorts(
      REF,
      GRANTED,
      { 'data.read': { rows: [{ id: 1 }], nextCursor: null } },
      log
    );
    expect(sdk('data.read', ['shopify', 'orders', null])).toEqual({
      ok: true,
      result: { rows: [{ id: 1 }], nextCursor: null },
    });
    expect(sdk('data.listSources', [])).toEqual({
      ok: false,
      error: 'AGENT_NOT_AVAILABLE',
      reason: 'no local fixture for data.listSources: add "data.listSources" to fixtures.json',
    });
    expect(log.map((l) => l.call)).toEqual(['data.read', 'data.listSources']);
  });

  it('a call the capability could not make on the platform is refused here too', () => {
    const sdk = localDevPorts(REF, GRANTED, { 'data.read': {} });
    expect(sdk('data.read', ['gorgias', 'q', null])).toEqual({
      ok: false,
      error: 'AGENT_FORBIDDEN',
      reason: 'SDK_PERMISSION_DENIED: missing source:gorgias',
    });
    expect(sdk('task.create', ['t', 'd'])).toMatchObject({ ok: false, error: 'AGENT_FORBIDDEN' });
    expect(sdk('db.drop', [])).toEqual({
      ok: false,
      error: 'AGENT_FORBIDDEN',
      reason: 'SDK_UNKNOWN_CALL',
    });
  });

  it('secrets.get is always a local handle, even when a fixture claims a value', () => {
    const sdk = localDevPorts(REF, GRANTED, { 'secrets.get': { handle: 'sk_live_real' } });
    expect(sdk('secrets.get', ['API_KEY'])).toEqual({
      ok: true,
      result: { handle: 'local-dev:API_KEY' },
    });
  });

  it('an effect is recorded and answered from its fixture; nothing is sent', () => {
    const log: LocalCall[] = [];
    const sdk = localDevPorts(REF, GRANTED, { 'conversation.reply': null }, log);
    expect(sdk('conversation.reply', ['c1', 'hi'])).toEqual({ ok: true, result: null });
    expect(log).toEqual([
      { call: 'conversation.reply', args: ['c1', 'hi'], answer: { ok: true, result: null } },
    ]);
  });
});

describe('the loopback server: the platform’s wire, behind a one-off token', () => {
  it('answers {call, args} with the bearer token; refuses without it or with a bad body', async () => {
    const server = await serveLocalSdk(
      localDevPorts(REF, [], { 'context.current': { agentId: null, runId: null } })
    );
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/sdk$/);
      const post = (body: string, token = server.token) =>
        fetch(server.url, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body });
      const ok = await post(JSON.stringify({ call: 'context.current', args: [] }));
      expect([ok.status, await ok.json()]).toEqual([
        200,
        { ok: true, result: { agentId: null, runId: null } },
      ]);
      const denied = await post(JSON.stringify({ call: 'agent.get', args: ['a'] }));
      expect([denied.status, ((await denied.json()) as { error: string }).error]).toEqual([
        403,
        'AGENT_FORBIDDEN',
      ]);
      expect((await post('{}', 'wrong')).status).toBe(401);
      expect((await post('not json')).status).toBe(400);
      expect(((await (await post('{"call": 1}')).json()) as { error: string }).error).toBe(
        'SDK_BAD_CALL'
      );
    } finally {
      await server.close();
    }
  });

  it('the local-dev module reaches nothing but its own loopback server', () => {
    const src = readFileSync(join(__dirname, 'local-dev.ts'), 'utf8');
    expect([...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort()).toEqual([
      './client',
      'node:crypto',
      'node:http',
    ]);
    expect(src).not.toMatch(/fetch\(|https?:\/\/(?!127\.0\.0\.1)/);
  });
});
