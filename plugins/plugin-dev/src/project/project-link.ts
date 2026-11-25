import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWriteFile, PROJECT_FILE, ProjectFileSchema, type ProjectFile } from '@revition/cli-core';

/**
 * T2.1.1 - the local link of a directory to an app and a cloud project: `.revition/project.json` (ids only, no
 * secrets; safe to commit) and the `.gitignore` additions for the CLI's local caches.
 */
export const GITIGNORE_LINES = ['.revition/cache', '.revition/assist/'] as const;

export function readLink(dir: string): ProjectFile | null {
  const file = join(dir, PROJECT_FILE);
  if (!existsSync(file)) return null;
  const r = ProjectFileSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  return r.success ? r.data : null;
}

export async function writeLink(dir: string, link: { readonly appId: string | null; readonly projectId: string | null }): Promise<string> {
  const value: ProjectFile = ProjectFileSchema.parse({ schemaVersion: 1, appId: link.appId, projectId: link.projectId });
  const file = join(dir, PROJECT_FILE);
  await atomicWriteFile(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

/** Adds the missing ignore lines; returns the lines added (none when already present). */
export async function ensureGitignore(dir: string): Promise<readonly string[]> {
  const file = join(dir, '.gitignore');
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const have = new Set(current.split(/\r?\n/).map((l) => l.trim()));
  const missing = GITIGNORE_LINES.filter((l) => !have.has(l));
  if (missing.length === 0) return [];
  const prefix = current === '' || current.endsWith('\n') ? current : `${current}\n`;
  await atomicWriteFile(file, `${prefix}${missing.join('\n')}\n`);
  return missing;
}
