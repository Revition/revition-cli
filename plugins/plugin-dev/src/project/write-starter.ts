import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

import { RevitionCliError, EXIT } from '@revition/cli-core';

/**
 * T2.1.1 - writing a starter's files into a project directory. Every file name comes from the server and is treated
 * as untrusted: an absolute path, a `..` segment, a drive letter or anything that resolves outside the target is
 * refused BEFORE anything is written (a starter file named `../../x` writes nothing). Existing files are never
 * overwritten; a non-empty directory is refused unless `force` (and even then no existing file is replaced).
 */
export type ProjectFiles = Readonly<Record<string, string>>;

export function unsafePath(dir: string, name: string): boolean {
  if (name === '' || isAbsolute(name) || /^[A-Za-z]:/.test(name) || name.includes('\0')) return true;
  const n = normalize(name);
  if (n.split(/[\\/]/).includes('..')) return true;
  const target = resolve(dir, n);
  const rel = relative(resolve(dir), target);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel);
}

function refuse(code: string, message: string, hint?: string): RevitionCliError {
  return new RevitionCliError({ code, message, ...(hint === undefined ? {} : { hint }) }, EXIT.usage);
}

/** Write `files` into `dir`. Returns the written relative paths (sorted). Throws before writing anything on a problem. */
export function writeStarter(dir: string, files: ProjectFiles, opts: { readonly force?: boolean } = {}): readonly string[] {
  const names = Object.keys(files).sort();
  const unsafe = names.filter((n) => unsafePath(dir, n));
  if (unsafe.length > 0) {
    throw refuse('STARTER_PATH_REFUSED', `The starter names a file outside the project: ${unsafe.join(', ')}. Nothing was written.`);
  }
  if (existsSync(dir) && readdirSync(dir).length > 0 && opts.force !== true) {
    throw refuse('DIRECTORY_NOT_EMPTY', `${dir} is not empty. Nothing was written.`, 'Choose a new directory, or pass --force to add the starter next to what is there.');
  }
  const taken = names.filter((n) => existsSync(join(dir, normalize(n))));
  if (taken.length > 0) {
    throw refuse('FILE_EXISTS', `${dir} already has ${taken.join(', ')}. Nothing was written.`);
  }
  for (const n of names) {
    const p = join(dir, normalize(n));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, files[n] ?? '', 'utf8');
  }
  return names.map((n) => normalize(n).split(sep).join('/'));
}
