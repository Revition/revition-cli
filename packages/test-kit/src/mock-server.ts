/**
 * T1.2.6 (REVITION-CLI-PLAN.md:1317-1318, Files :1323): the CLI's contract-CONSUMER mock. Generated from the published
 * contract (packages/api-client/openapi/v1.json): every request is matched to a contract operation (method + path
 * under the server base) and checked against it (path and query parameters, the JSON body schema); a request that does
 * not match is REJECTED (400, recorded as a violation), so a command calling the platform wrongly fails its test. A
 * matching request gets a response sampled from the operation's success schema. Prism-like, no network, no
 * dependency.
 */
import { readFileSync } from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

type Schema = Record<string, unknown>;

export interface Contract {
  readonly servers?: readonly { readonly url: string }[];
  readonly paths: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly components?: { readonly schemas?: Readonly<Record<string, Schema>> };
}

export const CONTRACT_PATH = fileURLToPath(new URL('../../api-client/openapi/v1.json', import.meta.url));

export function loadContract(path = CONTRACT_PATH): Contract {
  return JSON.parse(readFileSync(path, 'utf8')) as Contract;
}

const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

interface Op {
  readonly method: string;
  readonly template: string;
  readonly match: RegExp;
  readonly names: readonly string[];
  readonly spec: Readonly<Record<string, unknown>>;
}

function operationsOf(contract: Contract): Op[] {
  const out: Op[] = [];
  for (const [template, item] of Object.entries(contract.paths)) {
    const names = [...template.matchAll(/\{([^}]+)\}/gu)].map((m) => m[1] ?? '');
    const match = new RegExp(`^${template.replace(/[.*+?^$()|[\]\\]/gu, '\\$&').replace(/\\?\{[^}]+\\?\}/gu, '([^/]+)')}$`, 'u');
    for (const m of METHODS) {
      const spec = item[m];
      if (spec !== undefined) out.push({ method: m.toUpperCase(), template, match, names, spec: spec as Record<string, unknown> });
    }
  }
  // A literal segment beats a parameter (`/dev/apps/x` before `/dev/apps/{appId}`).
  return out.sort((a, b) => a.names.length - b.names.length);
}

function resolve(contract: Contract, s: Schema | undefined): Schema {
  if (s === undefined) return {};
  const ref = s['$ref'];
  if (typeof ref === 'string') {
    const name = ref.split('/').pop() ?? '';
    return resolve(contract, contract.components?.schemas?.[name]);
  }
  return s;
}

const typeOf = (v: unknown): string =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v;

/** The JSON-Schema subset the contract uses. Returns the problems found at `at`. PURE. */
export function schemaProblems(contract: Contract, raw: Schema | undefined, v: unknown, at = '$'): string[] {
  const s = resolve(contract, raw);
  for (const key of ['anyOf', 'oneOf'] as const) {
    const alts = s[key];
    if (Array.isArray(alts)) {
      return alts.some((a) => schemaProblems(contract, a as Schema, v, at).length === 0) ? [] : [`${at}: matches no ${key} alternative`];
    }
  }
  const types = s['type'] === undefined ? [] : Array.isArray(s['type']) ? (s['type'] as string[]) : [String(s['type'])];
  const t = typeOf(v);
  if (s['nullable'] === true && v === null) return [];
  if (types.length > 0 && !types.includes(t) && !(t === 'integer' && types.includes('number'))) return [`${at}: expected ${types.join('|')}, got ${t}`];
  const out: string[] = [];
  if (Array.isArray(s['enum']) && !(s['enum'] as unknown[]).includes(v)) out.push(`${at}: not one of ${JSON.stringify(s['enum'])}`);
  if (typeof v === 'string') {
    if (typeof s['minLength'] === 'number' && v.length < s['minLength']) out.push(`${at}: shorter than ${String(s['minLength'])}`);
    if (typeof s['maxLength'] === 'number' && v.length > s['maxLength']) out.push(`${at}: longer than ${String(s['maxLength'])}`);
  }
  if (typeof v === 'number') {
    if (typeof s['minimum'] === 'number' && v < s['minimum']) out.push(`${at}: below ${String(s['minimum'])}`);
    if (typeof s['maximum'] === 'number' && v > s['maximum']) out.push(`${at}: above ${String(s['maximum'])}`);
  }
  if (Array.isArray(v)) {
    if (typeof s['minItems'] === 'number' && v.length < s['minItems']) out.push(`${at}: fewer than ${String(s['minItems'])} items`);
    v.forEach((x, i) => out.push(...schemaProblems(contract, s['items'] as Schema | undefined, x, `${at}[${i}]`)));
  }
  if (t === 'object') {
    const o = v as Record<string, unknown>;
    const props = (s['properties'] ?? {}) as Record<string, Schema>;
    for (const r of (s['required'] ?? []) as string[]) if (!(r in o)) out.push(`${at}.${r}: required`);
    for (const [k, x] of Object.entries(o)) {
      if (k in props) out.push(...schemaProblems(contract, props[k], x, `${at}.${k}`));
      else if (s['additionalProperties'] === false) out.push(`${at}.${k}: not allowed`);
      else if (typeof s['additionalProperties'] === 'object') out.push(...schemaProblems(contract, s['additionalProperties'] as Schema, x, `${at}.${k}`));
    }
  }
  return out;
}

/** A minimal value that satisfies a schema (required fields only). PURE. */
export function sample(contract: Contract, raw: Schema | undefined, depth = 0): unknown {
  const s = resolve(contract, raw);
  if (depth > 8) return null;
  for (const key of ['anyOf', 'oneOf'] as const) {
    const alts = s[key];
    if (Array.isArray(alts) && alts.length > 0) return sample(contract, alts[0] as Schema, depth + 1);
  }
  if (Array.isArray(s['enum']) && (s['enum'] as unknown[]).length > 0) return (s['enum'] as unknown[])[0];
  const type = Array.isArray(s['type']) ? (s['type'] as string[]).find((x) => x !== 'null') : s['type'];
  if (type === 'string') return s['format'] === 'date-time' ? '2026-11-18T00:00:00.000Z' : 'x'.repeat(Math.max(1, Number(s['minLength'] ?? 1)));
  if (type === 'integer' || type === 'number') return typeof s['minimum'] === 'number' ? s['minimum'] : 1;
  if (type === 'boolean') return true;
  if (type === 'array') return Array.from({ length: Number(s['minItems'] ?? 0) }, () => sample(contract, s['items'] as Schema, depth + 1));
  if (type === 'object' || s['properties'] !== undefined) {
    const props = (s['properties'] ?? {}) as Record<string, Schema>;
    return Object.fromEntries(((s['required'] ?? []) as string[]).map((k) => [k, sample(contract, props[k], depth + 1)]));
  }
  return null;
}

export interface Checked {
  readonly operation: string | null;
  readonly problems: readonly string[];
  readonly success?: { readonly status: number; readonly body: unknown };
}

/** Check one request against the contract. PURE. */
export function checkRequest(contract: Contract, method: string, rawPath: string, query: URLSearchParams, body: string): Checked {
  const base = new URL(contract.servers?.[0]?.url ?? 'http://x/').pathname.replace(/\/+$/u, '');
  if (!rawPath.startsWith(`${base}/`)) return { operation: null, problems: [`${method} ${rawPath}: not under the contract base ${base}`] };
  const path = rawPath.slice(base.length);
  const op = operationsOf(contract).find((o) => o.method === method && o.match.test(path));
  if (op === undefined) return { operation: null, problems: [`${method} ${path}: no such operation in the contract`] };
  const problems: string[] = [];
  const params = (op.spec['parameters'] ?? []) as Array<{ name: string; in: string; required?: boolean; schema?: Schema }>;
  for (const p of params.filter((x) => x.in === 'query')) {
    const v = query.get(p.name);
    if (v === null && p.required === true) problems.push(`query ${p.name}: required`);
  }
  for (const q of query.keys()) {
    if (!params.some((p) => p.in === 'query' && p.name === q)) problems.push(`query ${q}: not in the contract`);
  }
  const rb = op.spec['requestBody'] as { required?: boolean; content?: Record<string, { schema?: Schema }> } | undefined;
  const bodySchema = rb?.content?.['application/json']?.schema;
  if (body.length === 0) {
    if (rb?.required === true) problems.push('body: required');
  } else if (bodySchema === undefined) {
    problems.push('body: the operation takes no body');
  } else {
    try {
      problems.push(...schemaProblems(contract, bodySchema, JSON.parse(body) as unknown, 'body'));
    } catch {
      problems.push('body: not JSON');
    }
  }
  const responses = (op.spec['responses'] ?? {}) as Record<string, { content?: Record<string, { schema?: Schema }> }>;
  const okKey = Object.keys(responses).find((k) => /^2\d\d$/u.test(k)) ?? '200';
  const schema = responses[okKey]?.content?.['application/json']?.schema;
  return {
    operation: `${op.method} ${op.template}`,
    problems,
    success: { status: Number(okKey), body: schema === undefined ? {} : sample(contract, schema) },
  };
}

export interface ContractCall {
  readonly operation: string | null;
  readonly method: string;
  readonly path: string;
  readonly problems: readonly string[];
}

export interface ContractMock {
  readonly host: string;
  readonly calls: ContractCall[];
  readonly violations: () => ContractCall[];
  close(): void;
}

/** The contract mock on 127.0.0.1. `overrides` may answer a matched operation with its own (contract-valid) body. */
export async function startContractMock(
  overrides: Readonly<Record<string, unknown>> = {},
  contract: Contract = loadContract()
): Promise<ContractMock> {
  const calls: ContractCall[] = [];
  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (d: Buffer) => (body += d.toString()));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://local');
      const method = req.method ?? 'GET';
      const c = checkRequest(contract, method, url.pathname, url.searchParams, body);
      calls.push({ operation: c.operation, method, path: url.pathname, problems: c.problems });
      const send = (status: number, payload: unknown): void =>
        void res.writeHead(status, { 'content-type': 'application/json', date: new Date().toUTCString() }).end(JSON.stringify(payload));
      if (c.problems.length > 0 || c.success === undefined) {
        send(400, { error: { code: 'CONTRACT_VIOLATION', message: c.problems.join('; ') } });
        return;
      }
      const key = c.operation ?? '';
      send(c.success.status, key in overrides ? overrides[key] : c.success.body);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    host: `127.0.0.1:${(server.address() as AddressInfo).port}`,
    calls,
    violations: () => calls.filter((c) => c.problems.length > 0),
    close: () => {
      server.close();
      server.closeAllConnections();
    },
  };
}
