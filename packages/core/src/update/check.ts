import { request } from 'undici';

import { isCi } from '../auth/ci-detect.js';
import { dispatcherFor } from '../transport/proxy.js';

import { writeUpdateCache, type UpdateCache } from './cache.js';

/**
 * T1.4.1 - the update notifier. The registry is the ONLY update source in v1 (npm, honouring the standard
 * `npm_config_registry`). The check runs in a detached background process AFTER a command finishes, so it never
 * delays or fails a command; the NEXT run prints the notice from the cache.
 */
export const PACKAGE = '@revition/cli';
export const CHANGELOG_URL = 'https://github.com/Revition/revition-cli/releases';
export type Channel = 'latest' | 'next' | 'canary';

/** The installed version's channel, from its prerelease suffix. PURE. */
export function channelOf(version: string): Channel {
  if (/-canary(\.|$)/.test(version)) return 'canary';
  if (/-(next|rc|beta|alpha)(\.|$)/.test(version)) return 'next';
  return 'latest';
}

export function registryBase(env: Readonly<Record<string, string | undefined>>): string {
  return (env['npm_config_registry'] ?? 'https://registry.npmjs.org').replace(/\/+$/, '');
}

/** When the notifier may run and print: never with --json, in CI, on a non-TTY stderr, or when turned off. PURE. */
export function updateCheckAllowed(i: {
  readonly json: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stderrIsTTY: boolean;
  readonly configUpdateCheck: boolean;
}): boolean {
  if (i.json || !i.stderrIsTTY || !i.configUpdateCheck) return false;
  if (isCi(i.env)) return false;
  if (i.env['REVITION_NO_UPDATE_CHECK'] === '1') return false;
  return true;
}

/** Semver-ish comparison of x.y.z[-pre]: is `a` newer than `b`? PURE. */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string): [number[], string] => {
    const [core, pre = ''] = v.replace(/^v/, '').split('-', 2) as [string, string?];
    return [core.split('.').map((x) => Number.parseInt(x, 10) || 0), pre];
  };
  const [ca, pa] = parse(a);
  const [cb, pb] = parse(b);
  for (let i = 0; i < 3; i++) if ((ca[i] ?? 0) !== (cb[i] ?? 0)) return (ca[i] ?? 0) > (cb[i] ?? 0);
  if (pa === pb) return false;
  if (pa === '') return true;
  if (pb === '') return false;
  return pa.localeCompare(pb, undefined, { numeric: true }) > 0;
}

/** The notice (stderr) the next run prints, or null. */
export function updateNotice(c: UpdateCache | null, installed: string): string | null {
  if (c === null) return null;
  const lines: string[] = [];
  if (c.deprecated !== null && c.installedVersion === installed) lines.push(`warn revition ${installed} is deprecated: ${c.deprecated}`);
  if (c.latest !== null && isNewer(c.latest, installed)) {
    lines.push(`Update available ${installed} -> ${c.latest} (${c.channel === 'latest' ? 'stable' : c.channel}). Run: revition upgrade   Changelog: ${CHANGELOG_URL}`);
  }
  return lines.length === 0 ? null : `${lines.join('\n')}\n`;
}

async function getJson(url: string, env: Readonly<Record<string, string | undefined>>): Promise<unknown> {
  const u = new URL(url);
  const res = await request(u, { dispatcher: dispatcherFor(u, env), headersTimeout: 10_000, bodyTimeout: 10_000, headers: { accept: 'application/json' } });
  if (res.statusCode >= 400) {
    await res.body.dump();
    return null;
  }
  return res.body.json();
}

/** The background check itself: dist-tags + the installed version's deprecation; written to the cache. */
export async function runUpdateCheck(i: {
  readonly installedVersion: string;
  readonly cacheDir: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now: number;
}): Promise<UpdateCache> {
  const base = registryBase(i.env);
  const channel = channelOf(i.installedVersion);
  // The plan's URL form: GET <registry>/-/package/@revition/cli/dist-tags.
  const name = PACKAGE;
  const tags = (await getJson(`${base}/-/package/${name}/dist-tags`, i.env).catch(() => null)) as Record<string, string> | null;
  const doc = (await getJson(`${base}/${name}/${i.installedVersion}`, i.env).catch(() => null)) as { deprecated?: unknown } | null;
  const c: UpdateCache = {
    channel,
    checkedAt: i.now,
    latest: tags?.[channel] ?? null,
    deprecated: typeof doc?.deprecated === 'string' ? doc.deprecated : null,
    installedVersion: i.installedVersion,
  };
  await writeUpdateCache(i.cacheDir, c);
  return c;
}
