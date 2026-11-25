import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { atomicWriteFile } from '@revition/cli-core';

/** Writes a project file atomically (temp file + rename in the same directory), keeping its mode (new: 0644). */
export function writeProjectFile(abs: string, content: string): void {
  const mode = existsSync(abs) ? statSync(abs).mode & 0o777 : 0o644;
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, content, { mode });
    renameSync(tmp, abs);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/**
 * T3.3.2 / T3.3.3 - before every applied write, the file's previous state is kept in `.revition/assist/backups/`
 * (on the default deny list: never read back to the model), so `/undo` can restore the last applied change.
 */
interface Backup {
  readonly rel: string;
  readonly existed: boolean;
  readonly content: string;
}

const dirOf = (root: string): string => join(root, '.revition', 'assist', 'backups');

function entries(root: string): string[] {
  const d = dirOf(root);
  return existsSync(d) ? readdirSync(d).filter((f) => /^\d+\.json$/.test(f)).sort((a, b) => Number(a.slice(0, -5)) - Number(b.slice(0, -5))) : [];
}

/** Keeps the state of `rel` before a write (`previous` null = the file did not exist). */
export async function pushBackup(root: string, rel: string, previous: string | null): Promise<void> {
  const d = dirOf(root);
  mkdirSync(d, { recursive: true, mode: 0o700 });
  const last = entries(root).at(-1);
  const n = last === undefined ? 1 : Number(last.slice(0, -5)) + 1;
  const b: Backup = { rel, existed: previous !== null, content: previous ?? '' };
  await atomicWriteFile(join(d, `${n}.json`), JSON.stringify(b));
}

/** Restores the last applied change; returns the path restored, or null when there is nothing to undo. */
export async function undoLast(root: string): Promise<string | null> {
  const last = entries(root).at(-1);
  if (last === undefined) return null;
  const file = join(dirOf(root), last);
  const b = JSON.parse(readFileSync(file, 'utf8')) as Backup;
  const target = join(root, b.rel);
  if (b.existed) writeProjectFile(target, b.content);
  else rmSync(target, { force: true });
  rmSync(file);
  return b.rel;
}
