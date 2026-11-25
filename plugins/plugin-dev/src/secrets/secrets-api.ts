import { ask, canPrompt, usageError, type ApiClient, type CommandContext } from '@revition/cli-core';

import { seg } from '../api.js';

/**
 * T2.2.3 - runtime secrets, server-side only. Two homes, one CLI shape:
 *   - the workspace's (an org member):  GET /runtime-secrets, PUT|DELETE /runtime-secrets/{name}
 *   - a developer app's (--app <id>):   GET /dev/apps/{appId}/secrets, PUT|DELETE /dev/apps/{appId}/secrets/{name}
 * Lists carry NAMES only; a value is never readable back, never an argument and never printed.
 */
export interface SecretName {
  readonly name: string;
  readonly updatedAt: string | null;
}

export interface SecretsList {
  readonly scope: 'workspace' | 'app';
  readonly appId: string | null;
  readonly names: readonly SecretName[];
  /** The one-time monthly cost of the FIRST app secret (the store it creates), when the platform passes one on. */
  readonly firstSetCost: { readonly monthlyUsd: number; readonly note: string } | null;
}

const base = (appId: string | null): string => (appId === null ? '/runtime-secrets' : `/dev/apps/${seg(appId)}/secrets`);

/**
 * T2.2.3 amended 2026-11-24 (ruling #313): the environment a WORKSPACE secret lives in. The workspace route takes it
 * (foundry-routes-handler.ts secretEnv: query `env` on GET / DELETE, body `env` on PUT; absent = prod). An app's
 * secrets are not environment-scoped, so --env with --app is refused (never silently ignored). PURE.
 */
export const SECRET_ENVS = ['dev', 'test', 'staging', 'prod'] as const;
export function secretEnvOf(appId: string | null, env: unknown): string | undefined {
  if (env === undefined || env === null) return undefined;
  if (appId !== null) throw usageError('SECRET_ENV_APP', "An app's secrets have no environment: --env applies to the workspace's secrets only.", 'Drop --env, or drop --app.');
  return String(env);
}
const envQuery = (env: string | undefined): Record<string, string> | undefined => (env === undefined ? undefined : { env });

export async function listSecrets(api: ApiClient, appId: string | null, env?: string): Promise<SecretsList> {
  const query = envQuery(env);
  const body = (await api.request<{ names: ReadonlyArray<string | SecretName>; firstSetCost?: SecretsList['firstSetCost'] }>({ method: 'GET', path: base(appId), ...(query === undefined ? {} : { query }) })).body;
  // Names only, whatever else the route carries.
  const names = (body.names ?? []).map((n) => (typeof n === 'string' ? { name: n, updatedAt: null } : { name: n.name, updatedAt: n.updatedAt ?? null }));
  return { scope: appId === null ? 'workspace' : 'app', appId, names, firstSetCost: body.firstSetCost ?? null };
}

export async function putSecret(api: ApiClient, appId: string | null, name: string, value: string, env?: string): Promise<void> {
  await api.request({ method: 'PUT', path: `${base(appId)}/${seg(name)}`, body: env === undefined ? { value } : { value, env } });
}

export async function deleteSecret(api: ApiClient, appId: string | null, name: string, env?: string): Promise<void> {
  const query = envQuery(env);
  await api.request({ method: 'DELETE', path: `${base(appId)}/${seg(name)}`, ...(query === undefined ? {} : { query }) });
}

/** The value: piped stdin (read to EOF; a certificate keeps its lines) or a hidden prompt on a terminal. */
export async function readSecretValue(ctx: CommandContext, stdin: NodeJS.ReadableStream & { isTTY?: boolean } = process.stdin): Promise<string> {
  let value: string;
  if (stdin.isTTY === true) {
    if (!canPrompt(ctx.io, { json: ctx.flags.json, noInput: ctx.flags.noInput })) {
      throw usageError('SECRET_VALUE_REQUIRED', 'The value comes from stdin or a hidden prompt, and prompts are off.', 'Pipe it in: revition secrets set NAME < value.txt');
    }
    value = await ask(ctx.io, 'Value (hidden):', { hidden: true });
  } else {
    const chunks: Buffer[] = [];
    for await (const c of stdin) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
    value = Buffer.concat(chunks).toString('utf8');
    // `echo value |` adds one newline to a one-line value; a multi-line value is kept exactly.
    if (!value.slice(0, -1).includes('\n')) value = value.replace(/\r?\n$/, '');
  }
  if (value === '') throw usageError('SECRET_VALUE_EMPTY', 'The value is empty.', 'Pipe it in: revition secrets set NAME < value.txt');
  return value;
}
