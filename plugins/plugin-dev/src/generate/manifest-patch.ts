import { EXIT, RevitionCliError } from '@revition/cli-core';

import { MAX_CAPABILITIES, MAX_PROJECT_BYTES, MAX_PROJECT_FILES, PROJECT_MANIFEST_PATH } from '../checks/local-checks.js';

/**
 * T2.1.5 - the only edits `generate` makes to existing files: an additive capability entry in `revition.json` and an
 * appended case in a `tests.json`, each shown as a diff before it is applied. The platform limits (5 capabilities,
 * 32 files, 1.5 MB) are checked against the RESULT before anything is written. PURE.
 */
type Files = Readonly<Record<string, string>>;

function refuse(code: string, message: string, hint?: string): RevitionCliError {
  return new RevitionCliError({ code, message, ...(hint === undefined ? {} : { hint }) }, EXIT.usage);
}

export function manifestOf(files: Files): { readonly summary: string; readonly capabilities: Array<Record<string, unknown>> } {
  const text = files[PROJECT_MANIFEST_PATH];
  if (text === undefined) throw refuse('NO_PROJECT', 'No revition.json here.', 'Run `revition init` to start a project.');
  try {
    const m = JSON.parse(text) as { summary: string; capabilities: Array<Record<string, unknown>> };
    if (!Array.isArray(m.capabilities)) throw new Error('capabilities');
    return m;
  } catch {
    throw refuse('MANIFEST_INVALID', 'revition.json is not a valid project manifest.', 'Run `revition build` to see the problem.');
  }
}

export function withCapability(manifestText: string, entry: Record<string, unknown>): string {
  const m = JSON.parse(manifestText) as { capabilities: unknown[] };
  return `${JSON.stringify({ ...m, capabilities: [...m.capabilities, entry] }, null, 2)}\n`;
}

/** A unified-style diff of two texts (whole-line), for the confirmation. */
export function lineDiff(file: string, before: string, after: string): string {
  const a = before.split('\n');
  const b = after.split('\n');
  const out = [`--- ${file}`, `+++ ${file}`];
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let ja = a.length - 1;
  let jb = b.length - 1;
  while (ja >= i && jb >= i && a[ja] === b[jb]) {
    ja--;
    jb--;
  }
  for (const l of a.slice(i, ja + 1)) out.push(`-${l}`);
  for (const l of b.slice(i, jb + 1)) out.push(`+${l}`);
  return `${out.join('\n')}\n`;
}

/** Refuses (exit 2, nothing written) when the result would break a platform limit or overwrite a file. */
export function assertWritable(current: Files, added: Files, opts: { readonly addsCapability: boolean }): void {
  const taken = Object.keys(added).filter((f) => current[f] !== undefined);
  if (taken.length > 0) throw refuse('FILE_EXISTS', `${taken.join(', ')} already ${taken.length === 1 ? 'exists' : 'exist'}: nothing was written.`);
  if (opts.addsCapability && manifestOf(current).capabilities.length >= MAX_CAPABILITIES) {
    throw refuse('CAPABILITY_LIMIT', `The project already has ${MAX_CAPABILITIES} capabilities, the platform limit: nothing was written.`);
  }
  const count = Object.keys(current).length + Object.keys(added).length;
  if (count > MAX_PROJECT_FILES) throw refuse('FILE_LIMIT', `That would make ${count} files; the platform limit is ${MAX_PROJECT_FILES}: nothing was written.`);
  const bytes = Object.entries({ ...current, ...added }).reduce((n, [f, t]) => n + Buffer.byteLength(f) + Buffer.byteLength(t), 0);
  if (bytes > MAX_PROJECT_BYTES) throw refuse('SIZE_LIMIT', `That would make ${bytes} bytes; the platform limit is ${MAX_PROJECT_BYTES}: nothing was written.`);
}
