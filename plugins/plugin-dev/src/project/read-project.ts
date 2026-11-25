import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { RevitionCliError, EXIT } from '@revition/cli-core';

/**
 * T2.1.2 - a project directory as the files the platform reads (the legacy CLI's reader, unchanged: the same files go
 * to `/dev/authoring/check`). Hidden entries (including `.revition/`), `node_modules` and `dist` are never read.
 */
export const MAX_LOCAL_FILES = 200;
const SKIPPED = new Set(['node_modules', 'dist']);

export function readProjectDir(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (at: string): void => {
    for (const name of readdirSync(at).sort()) {
      if (name.startsWith('.') || SKIPPED.has(name)) continue;
      const p = join(at, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (Object.keys(files).length >= MAX_LOCAL_FILES) {
        throw new RevitionCliError({ code: 'NOT_A_PROJECT', message: `More than ${MAX_LOCAL_FILES} files under ${dir}: is this a project directory?` }, EXIT.usage);
      }
      files[relative(dir, p).split(sep).join('/')] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return files;
}
