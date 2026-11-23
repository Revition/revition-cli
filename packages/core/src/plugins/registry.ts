import { request } from 'undici';

import { RevitionCliError } from '../errors/cli-error.js';
import { EXIT } from '../output/exit-codes.js';
import { dispatcherFor } from '../transport/proxy.js';

import type { Attestation, PluginRegistry, RegistryKey, RegistryVersion } from './verify.js';

/**
 * T4.2.1 - the npm registry, read only, over the CLI's own transport rules (TLS verification always on; HTTPS_PROXY /
 * NO_PROXY honoured, T1.1.5). Plugins come from the public npm registry only (the provenance checks are npm's).
 */
export const NPM_REGISTRY = 'https://registry.npmjs.org';
/** A plugin tarball larger than this is refused before it is read (a bundled plugin is far smaller). */
export const MAX_TARBALL_BYTES = 25 * 1024 * 1024;

const NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;

export function assertPluginName(name: string): void {
  if (!NAME.test(name) || name.length > 214) {
    throw new RevitionCliError({ code: 'PLUGIN_NAME_INVALID', message: `"${name}" is not an npm package name.` }, EXIT.usage);
  }
}

async function get(url: string, env: Readonly<Record<string, string | undefined>>, accept: string): Promise<{ status: number; body: Buffer }> {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new RevitionCliError({ code: 'PLUGIN_REGISTRY_NOT_HTTPS', message: `Refused a non-HTTPS URL: ${u.origin}` }, EXIT.network);
  const res = await request(u, { method: 'GET', headers: { accept }, dispatcher: dispatcherFor(u, env), maxRedirections: 0 } as Parameters<typeof request>[1]);
  const len = Number(res.headers['content-length'] ?? '0');
  if (len > MAX_TARBALL_BYTES) {
    await res.body.dump();
    throw new RevitionCliError({ code: 'PLUGIN_TOO_LARGE', message: `The plugin download is larger than ${MAX_TARBALL_BYTES} bytes.` }, EXIT.general);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of res.body) {
    total += (c as Buffer).length;
    if (total > MAX_TARBALL_BYTES) {
      throw new RevitionCliError({ code: 'PLUGIN_TOO_LARGE', message: `The plugin download is larger than ${MAX_TARBALL_BYTES} bytes.` }, EXIT.general);
    }
    chunks.push(c as Buffer);
  }
  return { status: res.statusCode, body: Buffer.concat(chunks) };
}

function notFound(what: string): RevitionCliError {
  return new RevitionCliError({ code: 'PLUGIN_NOT_FOUND', message: `${what} is not on the npm registry.` }, EXIT.notFound);
}

/** Picks the version for a range: an exact version, or `latest` (dist-tag). Ranges beyond those are refused. */
export function pickVersion(doc: { 'dist-tags'?: Record<string, string>; versions?: Record<string, unknown> }, range: string): string {
  const v = range === '' || range === 'latest' ? doc['dist-tags']?.['latest'] : range;
  if (v === undefined || doc.versions?.[v] === undefined) throw notFound(`Version ${range}`);
  return v;
}

export function npmRegistry(env: Readonly<Record<string, string | undefined>> = process.env): PluginRegistry {
  return {
    async version(name, range) {
      assertPluginName(name);
      const r = await get(`${NPM_REGISTRY}/${name.replaceAll('/', '%2f')}`, env, 'application/json');
      if (r.status === 404) throw notFound(name);
      if (r.status !== 200) throw new RevitionCliError({ code: 'PLUGIN_REGISTRY_ERROR', message: `The npm registry answered ${r.status}.` }, EXIT.server);
      const doc = JSON.parse(r.body.toString('utf8')) as {
        'dist-tags'?: Record<string, string>;
        versions?: Record<string, { name: string; version: string; dist: RegistryVersion['dist'] }>;
        time?: Record<string, string>;
      };
      const v = pickVersion(doc, range);
      const meta = doc.versions?.[v];
      if (meta === undefined) throw notFound(`${name}@${v}`);
      return { name: meta.name, version: meta.version, publishedAt: doc.time?.[v] ?? new Date(0).toISOString(), dist: meta.dist };
    },
    async attestations(name, version) {
      const r = await get(`${NPM_REGISTRY}/-/npm/v1/attestations/${name.replaceAll('/', '%2f')}@${version}`, env, 'application/json');
      if (r.status === 404) return null;
      if (r.status !== 200) throw new RevitionCliError({ code: 'PLUGIN_REGISTRY_ERROR', message: `The npm registry answered ${r.status}.` }, EXIT.server);
      return (JSON.parse(r.body.toString('utf8')) as { attestations?: Attestation[] }).attestations ?? null;
    },
    async keys() {
      const r = await get(`${NPM_REGISTRY}/-/npm/v1/keys`, env, 'application/json');
      if (r.status !== 200) throw new RevitionCliError({ code: 'PLUGIN_REGISTRY_ERROR', message: `The npm registry keys answered ${r.status}.` }, EXIT.server);
      return (JSON.parse(r.body.toString('utf8')) as { keys: RegistryKey[] }).keys;
    },
    async tarball(url) {
      const u = new URL(url);
      if (u.origin !== NPM_REGISTRY) throw new RevitionCliError({ code: 'PLUGIN_TARBALL_ORIGIN', message: `Refused a tarball from ${u.origin}.` }, EXIT.permission);
      const r = await get(url, env, 'application/octet-stream');
      if (r.status !== 200) throw notFound(url);
      return r.body;
    },
  };
}
