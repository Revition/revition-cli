/**
 * A scripted, STATEFUL stand-in for the platform the phase journeys (e2e/phaseN.e2e.ts) drive on staging, on 127.0.0.1.
 * Every request is first checked against the published CLI contract (the same check as the consumer mock,
 * packages/test-kit/src/mock-server.ts), so the rehearsal also proves that the journeys only make contract calls. Answers
 * come from the journey's state (a revoked token gets 401, a created key is listed, ...); an operation with no scripted
 * answer gets the contract's minimal sample. No answer ever involves a provider, a payment or another host.
 */
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import { checkRequest, loadContract } from '../../packages/test-kit/src/mock-server.js';

export interface PlatformCall {
  readonly method: string;
  readonly path: string;
  readonly operation: string | null;
  readonly problems: readonly string[];
  readonly status: number;
}

export interface JourneyPlatform {
  readonly host: string;
  readonly calls: PlatformCall[];
  readonly state: State;
  close(): void;
}

interface State {
  revoked: Set<string>;
  tokens: Array<{ tokenId: string; name: string; prefix: string; scopes: string[]; expiresAt: string; revokedAt: string | null; lastUsedAt: string | null }>;
  secrets: Map<string, string>;
  keys: Map<string, boolean>;
  keySeq: number;
  submissions: Map<string, Record<string, unknown>>;
  project: { files: Record<string, string>; version: number };
  audit: Array<Record<string, unknown>>;
  agent: { version: number; config: Record<string, unknown>; sections: Record<string, unknown> };
  report: Record<string, unknown> | null;
}

/** The draft's own Tests cases; the model-backed ones are paid (FOUNDRY tests/test-cases.ts MODEL_TYPES). */
const MODEL_TYPES = ['agent_behavior', 'prompt', 'regression', 'evaluation'];
function testCases(s: State): Array<{ id: string; type: string }> {
  const t = s.agent.sections['tests'] as { cases?: Array<{ id: string; type: string }> } | undefined;
  return t?.cases ?? [];
}
function testsQuote(s: State): { quoteId: string; draftVersion: number; modelCalls: number; freeCases: number; available: boolean; billedEstimateUsd: number } {
  const cases = testCases(s);
  const paid = cases.filter((c) => MODEL_TYPES.includes(c.type)).length;
  return { quoteId: `q_rehearsal_v${s.agent.version}_${paid}`, draftVersion: s.agent.version, modelCalls: paid, freeCases: cases.length - paid, available: true, billedEstimateUsd: 0.05 * paid };
}

const AGENT_LIVE: Record<string, unknown> = {
  systemPrompt: 'You are the rehearsal agent.',
  instructions: 'Answer from the returns policy.',
  skills: [],
  tools: [],
};

// The REAL platform answer of GET /dev/starters/hello-tool, captured from the Dev route table (handleDevRoute).
const STARTER = (JSON.parse(readFileSync(fileURLToPath(new URL('./starter-hello-tool.captured.json', import.meta.url)), 'utf8')) as {
  body: { id: string; title: string; extensionPoint: string; language: string; files: Record<string, string> };
}).body;
const EVAL_RUN = (appId: string, suiteId: string, quoteId: string): Record<string, unknown> => ({
  runId: 'devev_rehearsal', appId, suiteId, projectId: 'dproj_rehearsal', projectVersion: 1, digest: 'sha256:rehearsal',
  report: { capabilityId: 'hello', version: '1.0.0', suiteId, baseline: { task_success: 0.5 }, withCapability: { task_success: 1 }, delta: { task_success: 0.5 }, verdict: 'improves' },
  passRate: 1, cases: 1, at: AT, billedCredits: 0, quoteId,
});
const QUOTE = (appId: string, suiteId: string): Record<string, unknown> => ({
  quoteId: 'evq_rehearsalrehearsalrehearsalrehe', appId, projectId: 'dproj_rehearsal', suiteId, digest: 'sha256:rehearsal', cases: 1, modelCalls: 2, estCredits: null, balanceCredits: 0,
});
const view = (appId: string, keyId: string): Record<string, unknown> => ({ keyId, appId, scopes: [], issuedAt: AT, expiresAt: '2027-02-16T00:00:00Z', revokeAt: null });

/** The platform's human-only routes the journeys probe (sentinel/cli-scopes/human-only-routes.ts, D9). */
const HUMAN_ONLY = [/^\/dev\/apps\/[^/]+\/submissions\/[^/]+\/publish$/u, /^\/deployments\/[^/]+\/draft\/publish$/u];

type Reply = { readonly status: number; readonly body: unknown } | null;
type Handler = (m: RegExpMatchArray, body: unknown, s: State, token: string) => Reply;

const ok = (body: unknown, status = 200): Reply => ({ status, body });
const fail = (status: number, code: string, message: string): Reply => ({ status, body: { error: { code, message } } });
const AT = '2026-11-19T00:00:00.000Z';

/** Operation key (contract "METHOD /template") -> scripted answer. */
const HANDLERS: Record<string, Handler> = {
  'GET /dev/me': () =>
    ok({ developerId: 'dev_rehearsal', kind: 'tenant_member', linkedOrgId: 'org_rehearsal', identityRef: 'auth0|rehearsal', email: 'rehearsal@e2e.test', verified: true }),
  'GET /dev/tokens': (_m, _b, s) => ok({ tokens: s.tokens }),
  // A personal access token cannot mint another (the platform's own rule, T1.2.3): the CLI maps it to exit 4.
  'POST /dev/tokens': () => fail(403, 'PAT_CANNOT_CREATE_PAT', 'A personal access token cannot create another token.'),
  'DELETE /dev/tokens/{tokenId}': (m, _b, s) => {
    const t = s.tokens.find((x) => x.tokenId === decodeURIComponent(m[1] ?? ''));
    if (t === undefined) return fail(404, 'PAT_NOT_FOUND', 'No such token.');
    t.revokedAt = AT;
    s.revoked.add(t.prefix);
    return ok({ tokenId: t.tokenId, revokedAt: AT });
  },
  // Phase 2: starters, the project, keys, secrets, the quoted eval, submissions, versions / runs / analytics, audit.
  'GET /dev/starters': () => ok({ starters: [{ id: STARTER.id, title: STARTER.title, extensionPoint: STARTER.extensionPoint, language: STARTER.language }] }),
  'GET /dev/starters/{starterId}': () => ok(STARTER),
  'POST /dev/projects': (_m, b, s) => {
    s.project = { files: { ...STARTER.files, ...(((b as { files?: Record<string, string> } | null)?.files) ?? {}) }, version: 1 };
    return ok({ projectId: 'dproj_rehearsal', name: 'rehearsal', starterId: STARTER.id, version: 1 }, 201);
  },
  'GET /dev/projects/{projectId}': (m, _b, s) => ok({ projectId: m[1], name: 'rehearsal', starterId: STARTER.id, version: s.project.version, files: s.project.files }),
  'PUT /dev/projects/{projectId}/files': (m, b, s) => {
    const body = (b ?? {}) as { files?: Record<string, string> };
    s.project = { files: { ...s.project.files, ...(body.files ?? {}) }, version: s.project.version + 1 };
    return ok({ projectId: m[1], version: s.project.version });
  },
  // The platform's app manifest contract (monorepo devportal/registration/app-registration.ts:44-46, :125): a plugin
  // manifest, never the project's revition.json.
  'POST /dev/apps': (_m, b) => {
    const m = ((b ?? {}) as { manifest?: Record<string, unknown> }).manifest ?? {};
    const valid = typeof m['pluginId'] === 'string' && /^[a-z0-9][a-z0-9-]{1,62}$/u.test(m['pluginId']) && typeof m['brand'] === 'string' && m['brand'] !== ''
      && typeof m['category'] === 'string' && m['category'] !== '' && typeof m['description'] === 'string' && typeof m['version'] === 'string' && Array.isArray(m['dataClasses']);
    if (!valid) return fail(400, 'DEV_APP_MANIFEST_INVALID', 'the manifest is a plugin manifest (pluginId, brand, category, description, version, dataClasses)');
    return ok({ appId: 'dapp_rehearsal', manifestRef: `plugin://${String(m['pluginId'])}@${String(m['version'])}`, declaredScopes: [], createdAt: AT }, 201);
  },
  'GET /dev/apps': () => ok({ apps: [{ appId: 'dapp_rehearsal', manifestRef: 'plugin://hello-tool@0.1.0', manifest: {}, declaredScopes: [], createdAt: AT }] }),
  'POST /dev/apps/{appId}/keys': (m, _b, s) => {
    const keyId = `${(++s.keySeq).toString(16).padStart(16, '0')}`;
    s.keys.set(keyId, true);
    s.audit.push({ event: 'key_issued', at: Date.now(), client: 'cli', keyId });
    return ok({ keyRef: `ref_${keyId}`, key: `rdk_${keyId}_${'K'.repeat(43)}`, view: view(m[1] ?? '', keyId) }, 201);
  },
  'POST /dev/apps/{appId}/keys/{keyId}/rotate': (m, _b, s) => {
    const keyId = `${(++s.keySeq).toString(16).padStart(16, '0')}`;
    s.keys.set(keyId, true);
    return ok({ keyRef: `ref_${keyId}`, key: `rdk_${keyId}_${'L'.repeat(43)}`, view: view(m[1] ?? '', keyId) });
  },
  'DELETE /dev/apps/{appId}/keys/{keyId}': (m, _b, s) => (s.keys.delete(m[2] ?? '') ? ok({ revoked: true }) : fail(404, 'DEV_KEY_NOT_FOUND', 'No such key.')),
  'GET /dev/apps/{appId}/secrets': (_m, _b, s) => ok({ names: [...s.secrets.keys()].sort().map((name) => ({ name, updatedAt: AT })), firstSetCost: null }),
  'PUT /dev/apps/{appId}/secrets/{name}': (m, b, s) => {
    s.secrets.set(m[2] ?? '', String((b as { value?: string } | null)?.value ?? ''));
    return ok({ name: m[2] });
  },
  'DELETE /dev/apps/{appId}/secrets/{name}': (m, _b, s) => (s.secrets.delete(m[2] ?? '') ? ok({ name: m[2] }) : fail(404, 'DEV_SECRET_NOT_FOUND', 'No such secret.')),
  // The platform quotes only a measurable saved suite (monorepo devportal/eval/dev-eval.ts:153-167).
  'GET /dev/apps/{appId}/evals/quote': (m, _b, s) => {
    const raw = s.project.files['evals/journey.json'];
    const suite = raw === undefined ? null : (JSON.parse(raw) as { dimensions?: string[]; cases?: Array<{ expected?: unknown }> });
    const text = (suite?.dimensions ?? []).some((d) => d === 'task_success' || d === 'output_quality');
    const measured = text && (suite?.cases ?? []).length > 0 && (suite?.cases ?? []).every((c) => typeof c.expected === 'string');
    return measured ? ok(QUOTE(m[1] ?? '', 'journey')) : fail(400, 'AGENT_INVALID_INPUT', 'measure at least one of task_success, output_quality (a reference text)');
  },
  'POST /dev/apps/{appId}/evals': (m, b) => ok(EVAL_RUN(m[1] ?? '', 'journey', String((b as { quoteId?: string } | null)?.quoteId ?? '')), 201),
  'GET /dev/apps/{appId}/evals': (m) => ok({ runs: [EVAL_RUN(m[1] ?? '', 'journey', 'evq')] }),
  'POST /dev/apps/{appId}/submissions': (m, b, s) => {
    const version = String((b as { version?: string } | null)?.version ?? '');
    const sub = { submissionId: `sub_${version}`, appId: m[1], version, state: 'in_review', projectId: 'dproj_rehearsal', projectVersion: 1, autoResults: {}, reviewNotes: [], history: [], createdAt: AT, updatedAt: AT };
    s.submissions.set(version, sub);
    return ok(sub, 201);
  },
  'GET /dev/apps/{appId}/submissions': (_m, _b, s) => ok({ submissions: [...s.submissions.values()] }),
  'GET /dev/apps/{appId}/submissions/{version}': (m, _b, s) => {
    const sub = s.submissions.get(m[2] ?? '');
    return sub === undefined ? fail(404, 'DEV_SUBMISSION_NOT_FOUND', 'No such submission.') : ok(sub);
  },
  'GET /dev/audit': (_m, _b, s) => ok({ events: s.audit }),
  'GET /dev/apps/{appId}/runs': () => ok({ runs: [{ runId: 'devev_rehearsal', kind: 'eval', at: AT, ok: true, label: 'journey' }], notes: [] }),
  // Phase 3: the test agent's draft (agents-as-code on the EXISTING draft routes, T3.1.2), with the baseVersion rule.
  'GET /deployments/{deploymentId}': (m) => ok({ deploymentId: m[1], name: 'Rehearsal Agent', status: 'live' }),
  'GET /deployments/{deploymentId}/draft': (_m, _b, s) => ok({ draft: { version: s.agent.version, config: s.agent.config, sections: s.agent.sections } }),
  'PUT /deployments/{deploymentId}/draft': (_m, b, s) => {
    const body = b as { config: Record<string, unknown>; sections: Record<string, unknown>; baseVersion?: number };
    if (body.baseVersion !== undefined && body.baseVersion !== s.agent.version) {
      return { status: 409, body: { error: { code: 'AGENT_DRAFT_CONFLICT', message: 'The draft changed.', currentVersion: s.agent.version } } };
    }
    const changed = JSON.stringify([body.config, body.sections]) !== JSON.stringify([s.agent.config, s.agent.sections]);
    if (changed) s.agent = { version: s.agent.version + 1, config: body.config, sections: body.sections };
    return ok({ draft: { version: s.agent.version, config: s.agent.config, sections: s.agent.sections }, changed });
  },
  'GET /deployments/{deploymentId}/draft/diff': (_m, _b, s) => {
    const changed = Object.keys(s.agent.config).filter((k) => JSON.stringify(s.agent.config[k]) !== JSON.stringify(AGENT_LIVE[k]));
    return ok({ changedSections: changed, added: [], removed: [], hasUnsavedChanges: changed.length > 0 });
  },
  // T3.1.4: the draft's Tests, scripted: the quote counts the authored model-backed cases; a paid run needs that quoteId.
  'GET /deployments/{deploymentId}/tests/quote': (_m, _b, s) => ok(testsQuote(s)),
  'POST /deployments/{deploymentId}/tests/run': (_m, b, s) => {
    const q = testsQuote(s);
    if (q.modelCalls > 0 && (b as { quoteId?: string } | null)?.quoteId !== q.quoteId) {
      return { status: 409, body: { error: { code: 'AGENT_QUOTE_MISMATCH', message: 'Run the quote you were shown.' } } };
    }
    const results = testCases(s).map((c) => ({ caseId: c.id, type: c.type, status: 'passed', passed: true }));
    s.report = { draftVersion: s.agent.version, results, regressionCount: 0, allPassed: true };
    return ok(s.report);
  },
  'GET /deployments/{deploymentId}/tests/report': (_m, _b, s) =>
    ok({ report: s.report, run: s.report === null ? null : { status: 'finished', done: (s.report['results'] as unknown[]).length, total: (s.report['results'] as unknown[]).length } }),
  'GET /deployments/{deploymentId}/environments': () => ok({ managed: null, environments: [{ env: 'prod', provisioned: true, artifactRef: 'art_rehearsal', pending: null }, { env: 'staging', provisioned: true, artifactRef: null, pending: { from: 'staging', to: 'prod', requestedBy: 'usr_rehearsal', requestedAt: AT } }] }),
  // The metered sandbox leg, scripted: open, one run, dispose (no provider exists behind it).
  'POST /dev/projects/{projectId}/sandbox': (m) => ok({ sessionId: 'dsbx_rehearsal', projectId: m[1], tier: 'dev', provider: 'rehearsal', expiresAt: '2026-11-19T00:20:00Z', resumed: false }),
  'POST /dev/projects/{projectId}/sandbox/run': (_m, b) => ok({ ok: true, output: { greeting: `Hello, ${String(((b as { input?: { name?: string } } | null)?.input?.name) ?? 'world')}` }, logs: [], wallMs: 1 }),
  'DELETE /dev/projects/{projectId}/sandbox': () => ok({ disposed: true }),
};

function templateRegex(template: string): RegExp {
  return new RegExp(`^${template.replace(/[.*+?^$()|[\]\\]/gu, '\\$&').replace(/\\\{[^}]+\\\}|\{[^}]+\}/gu, '([^/]+)')}$`, 'u');
}

function older(a: string, b: string): boolean {
  const pa = a.split(/[.-]/u).slice(0, 3).map(Number);
  const pb = b.split(/[.-]/u).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  return false;
}

/** `minCliVersion`: the platform's MIN_CLI_VERSION raised for the forced-upgrade probe (T1.2.5 AC3, the 426 path). */
export async function startJourneyPlatform(token: string, opts: { readonly minCliVersion?: string } = {}): Promise<JourneyPlatform> {
  const contract = loadContract();
  const base = new URL(contract.servers?.[0]?.url ?? 'http://x/').pathname.replace(/\/+$/u, '');
  const state: State = {
    revoked: new Set(),
    tokens: [{ tokenId: 'tok_journey', name: 'journey-ci', prefix: token.slice(0, 8), scopes: ['cli:read'], expiresAt: '2026-12-19T00:00:00.000Z', revokedAt: null, lastUsedAt: null }],
    secrets: new Map(),
    keys: new Map(),
    keySeq: 0x0123abcd,
    submissions: new Map(),
    project: { files: { ...STARTER.files }, version: 1 },
    audit: [{ event: 'app_registered', at: Date.now(), client: 'cli', appId: 'dapp_rehearsal' }],
    agent: { version: 3, config: { ...AGENT_LIVE }, sections: { governance: { autonomy: 'draft' } } },
    report: null,
  };
  const calls: PlatformCall[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d: Buffer) => (raw += d.toString()));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://local');
      const method = req.method ?? 'GET';
      const auth = String(req.headers['authorization'] ?? '');
      const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const checked = checkRequest(contract, method, url.pathname, url.searchParams, raw);
      let reply: Reply;
      const cliVersion = String(req.headers['revition-cli-version'] ?? '');
      if (opts.minCliVersion !== undefined && cliVersion !== '' && older(cliVersion, opts.minCliVersion)) {
        reply = { status: 426, body: { error: { code: 'CLI_UPGRADE_REQUIRED', message: `Revition CLI ${cliVersion} is no longer supported. Run: npm i -g @revition/cli@latest`, minVersion: opts.minCliVersion } } };
      } else if (!bearer.startsWith('rvt_') && !bearer.startsWith('rvs_')) reply = fail(401, 'CLI_SIGN_IN_REQUIRED', 'Sign in first.');
      else if ([...state.revoked].some((p) => bearer.startsWith(p))) reply = fail(401, 'PAT_REVOKED', 'This token was revoked.');
      else if (HUMAN_ONLY.some((r) => r.test(url.pathname.slice(base.length)))) {
        reply = { status: 403, body: { error: { code: 'HUMAN_ACTION_REQUIRED', message: 'A person completes this in the developer portal.', portalUrl: 'https://developer.revition.com/apps' } } };
      } else if (checked.problems.length > 0 || checked.operation === null) reply = fail(400, 'CONTRACT_VIOLATION', checked.problems.join('; '));
      else {
        const template = checked.operation.slice(checked.operation.indexOf(' ') + 1);
        const path = url.pathname.slice(base.length);
        const handler = HANDLERS[checked.operation];
        const m = path.match(templateRegex(template)) ?? ([] as unknown as RegExpMatchArray);
        const body = raw === '' ? null : (JSON.parse(raw) as unknown);
        reply = handler === undefined ? null : handler(m, body, state, bearer);
        if (reply === null) reply = ok(checked.success?.body ?? {}, checked.success?.status ?? 200);
      }
      calls.push({ method, path: url.pathname, operation: checked.operation, problems: checked.problems, status: reply!.status });
      res.writeHead(reply!.status, { 'content-type': 'application/json', date: new Date().toUTCString() }).end(JSON.stringify(reply!.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    host: `127.0.0.1:${(server.address() as AddressInfo).port}`,
    calls,
    state,
    close: () => {
      server.close();
      server.closeAllConnections();
    },
  };
}
