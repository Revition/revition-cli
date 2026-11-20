import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EXIT, RevitionCliError, SECRET_PATTERNS } from '@revition/cli-core';

import { readProjectDir } from '../project/read-project.js';

/**
 * T2.1.4 - what `dev --sandbox` uploads: the FULL project file set (the platform stores whole revisions), minus what
 * `.revitionignore` and `.gitignore` exclude, never `.env*`, key files or `.revition/` (hidden entries are never read),
 * and NEVER a file whose content looks like a secret: one is found -> the upload is blocked, naming the file.
 */
const KEY_FILE = /(^|\/)(\.env[^/]*|id_(rsa|dsa|ecdsa|ed25519)[^/]*|[^/]+\.(pem|key|p12|pfx))$/i;
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/** One ignore-file line as a matcher: `name`, `dir/`, `*.ext`, `a/**` (no negation). PURE. */
export function ignoreMatcher(line: string): ((path: string) => boolean) | null {
  const t = line.trim();
  if (t === '' || t.startsWith('#') || t.startsWith('!')) return null;
  const dirOnly = t.endsWith('/');
  const body = t.replace(/^\/+/, '').replace(/\/+$/, '');
  const rx = body
    .split('**')
    .map((part) => part.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*'))
    .join('.*');
  const anchored = t.startsWith('/') || body.includes('/');
  const re = new RegExp(`${anchored ? '^' : '(^|/)'}${rx}${dirOnly ? '/' : '(/|$)'}`);
  return (path: string) => re.test(dirOnly ? `${path}/` : path) || re.test(path);
}

export function ignoredBy(dir: string): (path: string) => boolean {
  const matchers = ['.revitionignore', '.gitignore']
    .map((f) => join(dir, f))
    .filter((f) => existsSync(f))
    .flatMap((f) => readFileSync(f, 'utf8').split(/\r?\n/))
    .map(ignoreMatcher)
    .filter((m): m is (path: string) => boolean => m !== null);
  return (path) => matchers.some((m) => m(path));
}

export function secretIn(text: string): boolean {
  return PRIVATE_KEY_BLOCK.test(text) || SECRET_PATTERNS.some((p) => new RegExp(p.source, p.flags.replace('g', '')).test(text));
}

export interface Upload {
  readonly files: Readonly<Record<string, string>>;
  readonly excluded: readonly string[];
}

/** The files to upload, or a refusal naming every file that holds a secret (nothing is sent). PURE given the files. */
export function uploadSet(all: Readonly<Record<string, string>>, ignored: (path: string) => boolean): Upload {
  const files: Record<string, string> = {};
  const excluded: string[] = [];
  for (const [path, text] of Object.entries(all)) {
    if (KEY_FILE.test(path) || ignored(path)) {
      excluded.push(path);
      continue;
    }
    files[path] = text;
  }
  const leaking = Object.entries(files).filter(([, text]) => secretIn(text)).map(([p]) => p);
  if (leaking.length > 0) {
    throw new RevitionCliError(
      {
        code: 'UPLOAD_SECRET_REFUSED',
        message: `Not uploaded: ${leaking.join(', ')} ${leaking.length === 1 ? 'contains' : 'contain'} what looks like a secret.`,
        hint: 'Move the value to `revition secrets set` (server-side) or add the file to .revitionignore.',
      },
      EXIT.usage
    );
  }
  return { files, excluded };
}

export function projectUpload(dir: string): Upload {
  return uploadSet(readProjectDir(dir), ignoredBy(dir));
}
