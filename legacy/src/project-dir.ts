/**
 * A project directory on the developer's machine, as the files the platform reads. The CLI knows no layout of its
 * own: it sends every file and the platform's one project reader (`devportal/authoring/project.ts`) says what is
 * wrong, by file. Hidden entries, `node_modules`, `dist` and `.git` are never read.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';

import type { ProjectFiles } from './client';

/** Far above the platform's project limit (32 files): it only stops the CLI reading a whole home directory. */
export const MAX_LOCAL_FILES = 200;
const SKIPPED = new Set(['node_modules', 'dist']);

export function readProjectDir(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (at: string): void => {
    for (const name of readdirSync(at).sort()) {
      if (name.startsWith('.') || SKIPPED.has(name)) {
        continue;
      }
      const p = join(at, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (Object.keys(files).length >= MAX_LOCAL_FILES) {
        throw new Error(
          `more than ${MAX_LOCAL_FILES} files under ${dir}: is this a project directory?`
        );
      }
      files[relative(dir, p).split(sep).join('/')] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return files;
}

/** A path the platform sent, kept inside `dir`. */
function inside(dir: string, path: string): string {
  const n = normalize(path);
  if (isAbsolute(n) || n.startsWith('..') || n.split(/[\\/]/).includes('..')) {
    throw new Error(`refusing a path outside the project: ${path}`);
  }
  return join(dir, n);
}

/** Write a project into `dir`. Never overwrites: an existing file stops it before anything is written. */
export function writeProjectDir(dir: string, files: ProjectFiles): readonly string[] {
  const targets = Object.keys(files)
    .sort()
    .map((f) => [f, inside(dir, f)] as const);
  const taken = targets.filter(([, p]) => existsSync(p)).map(([f]) => f);
  if (taken.length > 0) {
    throw new Error(`${dir} already has ${taken.join(', ')}: nothing was written`);
  }
  for (const [f, p] of targets) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, files[f]!, 'utf8');
  }
  return targets.map(([f]) => f);
}
