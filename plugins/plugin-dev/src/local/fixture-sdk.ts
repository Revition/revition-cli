/**
 * T2.1.3 (REVITION-CLI-PLAN.md:2021-2024; Q1 answered from the plan): the Extension SDK for `revition test`, answered
 * from the project's `fixtures.json` with NO network and NO credential. Ported from the platform's own dev sandbox
 * (`apps/api/src/services/foundry/devportal/sandbox/fixture-sdk.ts`):
 *   - THE SAME CALLS AND PERMISSIONS: each call needs exactly the permission templates of the published reference
 *     (SDK_CALLS below, exported from the platform's `sdkCallTable()` by `scripts-local/export-sdk-call-table.ts`,
 *     SDK 1.0.0), granted by the platform's rule (a resource family whole with `family:*`, never an effect by
 *     wildcard) from what the capability declares (`sdkPermissions` in revition.json, the platform's
 *     `grantedSdkPermissions`);
 *   - NO REAL DATA: an answer comes only from a fixture; a call with none is refused with the fix; `secrets.get` returns
 *     a sandbox handle, never a value;
 *   - THE SAME SHAPE: `revition.sdk(call, ...args)` in TypeScript, `revition_sdk(call, *args)` in Python. PURE.
 */

interface CallRow {
  readonly params: readonly string[];
  readonly permissions: readonly string[];
}

export const SDK_VERSION = '1.0.0';

/** The platform's SDK call table (SDK 1.0.0), pinned. */
export const SDK_CALLS: Readonly<Record<string, CallRow>> = {
  'agent.get': { params: ['agentId'], permissions: ['agent:read'] },
  'context.current': { params: [], permissions: [] },
  'context.addInstruction': { params: ['text'], permissions: ['context:write'] },
  'tool.list': { params: [], permissions: [] },
  'tool.invoke': { params: ['ref', 'args'], permissions: ['capability:<ref>'] },
  'knowledge.search': { params: ['query', 'limit'], permissions: ['effect:read', 'knowledge:read'] },
  'data.listSources': { params: [], permissions: ['effect:read'] },
  'data.read': { params: ['sourceId', 'query', 'cursor'], permissions: ['effect:read', 'source:<sourceId>'] },
  'file.get': { params: ['fileId'], permissions: ['file:read'] },
  'file.put': { params: ['name', 'bytes'], permissions: ['effect:change', 'file:write'] },
  'user.current': { params: [], permissions: ['user:read'] },
  'conversation.history': { params: ['conversationId'], permissions: ['effect:read', 'conversation:read'] },
  'conversation.reply': { params: ['conversationId', 'text'], permissions: ['effect:send', 'conversation:reply'] },
  'task.create': { params: ['title', 'detail'], permissions: ['effect:change', 'task:write'] },
  'task.update': { params: ['taskId', 'status'], permissions: ['effect:change', 'task:write'] },
  'workflow.start': { params: ['workflowId', 'input'], permissions: ['effect:change', 'workflow:<workflowId>'] },
  'event.emit': { params: ['name', 'payload'], permissions: ['event:<name>'] },
  'ai.complete': { params: ['prompt', 'maxTokens'], permissions: ['ai:complete'] },
  'ui.render': { params: ['surface', 'tree'], permissions: ['ui:render'] },
  'notification.send': { params: ['toUserId', 'message'], permissions: ['effect:send', 'notification:send'] },
  'secrets.get': { params: ['name'], permissions: ['secret:<name>'] },
  'observability.log': { params: ['event', 'detail'], permissions: [] },
  'observability.metric': { params: ['name', 'value'], permissions: [] },
};

export interface FixtureSdkSpec {
  readonly fixtures: Readonly<Record<string, unknown>>;
  readonly granted: readonly string[];
}

/** A JSON value as a string literal both TypeScript and Python read (JSON escapes are valid in both). */
const literal = (v: unknown): string => JSON.stringify(JSON.stringify(v));

/** The SDK client for a local test run: calls, grants and fixtures embedded; nothing reached over a network. */
export function fixtureSdkPrelude(language: 'typescript' | 'python', spec: FixtureSdkSpec): string {
  const data = literal({ calls: SDK_CALLS, granted: spec.granted, fixtures: spec.fixtures });
  if (language === 'python') {
    return [
      'import json as __rv_sdk_json',
      `__rv_sdk = __rv_sdk_json.loads(${data})`,
      'def __rv_sdk_str(v):',
      "    return 'null' if v is None else ('true' if v is True else ('false' if v is False else str(v)))",
      'def __rv_sdk_granted(p):',
      "    g = __rv_sdk['granted']",
      "    i = p.find(':')",
      "    return p in g or (i > 0 and not p.startswith('effect:') and (p[:i] + ':*') in g)",
      'def revition_sdk(call, *args):',
      "    c = __rv_sdk['calls'].get(call)",
      '    if c is None:',
      "        raise RuntimeError('SDK ' + call + ' refused: AGENT_FORBIDDEN')",
      '    need = []',
      "    for p in c['permissions']:",
      "        for i, n in enumerate(c['params']):",
      "            p = p.replace('<' + n + '>', __rv_sdk_str(args[i]) if i < len(args) else 'undefined')",
      '        need.append(p)',
      '    if any(not __rv_sdk_granted(p) for p in need):',
      "        raise RuntimeError('SDK ' + call + ' refused: AGENT_FORBIDDEN')",
      "    if call == 'secrets.get':",
      "        return {'handle': 'dev-sandbox:' + str(args[0])}",
      "    if call not in __rv_sdk['fixtures']:",
      "        raise RuntimeError('SDK ' + call + ' refused: no fixture (add \"' + call + '\" to fixtures.json)')",
      "    return __rv_sdk['fixtures'][call]",
      '',
    ].join('\n');
  }
  return [
    `const __rvSdk = JSON.parse(${data});`,
    'const __rvGranted = (p) => {',
    '  const i = p.indexOf(":");',
    '  const g = __rvSdk.granted;',
    '  return g.includes(p) || (i > 0 && !p.startsWith("effect:") && g.includes(p.slice(0, i) + ":*"));',
    '};',
    'const revition = {',
    '  sdk: async (call, ...args) => {',
    '    const c = __rvSdk.calls[call];',
    '    if (c === undefined) {',
    "      throw new Error('SDK ' + call + ' refused: AGENT_FORBIDDEN');",
    '    }',
    '    const fill = (p) => c.params.reduce((o, n, i) => o.split("<" + n + ">").join(String(args[i])), p);',
    '    const need = c.permissions.map(fill);',
    '    if (need.some((p) => !__rvGranted(p))) {',
    "      throw new Error('SDK ' + call + ' refused: AGENT_FORBIDDEN');",
    '    }',
    "    if (call === 'secrets.get') {",
    "      return { handle: 'dev-sandbox:' + String(args[0]) };",
    '    }',
    '    if (!Object.prototype.hasOwnProperty.call(__rvSdk.fixtures, call)) {',
    "      throw new Error('SDK ' + call + ' refused: no fixture (add \"' + call + '\" to fixtures.json)');",
    '    }',
    '    return __rvSdk.fixtures[call];',
    '  },',
    '};',
    '',
  ].join('\n');
}
