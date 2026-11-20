import { closeSync, existsSync, lstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { PermissionPolicy } from './policy.js';

/**
 * T3.3.2 - path confinement. Every path a local tool touches is resolved to its REAL path (symlinks, and Windows
 * junctions, which realpath also follows) and must stay inside the project root; the deny list is checked on both
 * the asked path and the real one, and deny wins over allow.
 */
export class PolicyRefusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** Larger files are refused (the model gets the reason, not the bytes). */
export const MAX_FILE_BYTES = 1024 * 1024;

/** A glob over a root-relative POSIX path: `**` any depth, `*` / `?` within a segment; no `/` = any directory. PURE. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] ?? '';
    if (c === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/';
      re += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(glob.includes('/') ? `^${re}$` : `^(?:.*/)?${re}$`);
}

export function matchesAny(rel: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(rel));
}

const posix = (p: string): string => p.split(sep).join('/');

function isDanglingLink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink() && !existsSync(p);
  } catch {
    return false;
  }
}

/** The real path of `abs`, or (for a file not written yet) its nearest existing parent's real path + the rest. */
function realOf(abs: string): string {
  // A link to a target that does not exist yet would be followed by a write: refused, wherever it points.
  if (isDanglingLink(abs)) throw new PolicyRefusal('blocked by policy: a symbolic link to a missing target');
  if (existsSync(abs)) return realpathSync(abs);
  const parent = dirname(abs);
  if (parent === abs) return abs;
  return join(realOf(parent), basename(abs));
}

export interface GuardedPath {
  readonly abs: string;
  /** Root-relative, POSIX separators ('' = the root itself). */
  readonly rel: string;
}

/**
 * The real, confined path for `requested` (relative to the root, or absolute), or a PolicyRefusal. `purpose` 'read'
 * also applies `allowRead` when it is set; the deny list applies to every purpose. PURE apart from the fs reads.
 */
export function guardPath(policy: PermissionPolicy, requested: string, purpose: 'read' | 'write' | 'list'): GuardedPath {
  if (requested.includes('\0')) throw new PolicyRefusal('blocked by policy: an invalid path');
  const asked = resolve(policy.root, requested);
  const real = realOf(asked);
  const rel = relative(policy.root, real);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new PolicyRefusal(`blocked by policy: ${requested} is outside the project`);
  const relPosix = posix(rel);
  const askedRel = posix(relative(policy.root, asked));
  for (const r of [relPosix, askedRel]) {
    if (r !== '' && matchesAny(r, policy.denyRead)) throw new PolicyRefusal(`blocked by policy: ${requested} is on the deny list`);
  }
  if (purpose === 'read' && policy.allowRead.length > 0 && !matchesAny(relPosix, policy.allowRead)) {
    throw new PolicyRefusal(`blocked by policy: ${requested} is not on the allow list`);
  }
  return { abs: real, rel: relPosix };
}

/** Refuses a file too large or binary to send (NUL byte in its first 8 KB). */
export function assertTextFile(g: GuardedPath): void {
  const st = statSync(g.abs);
  if (!st.isFile()) throw new PolicyRefusal(`blocked by policy: ${g.rel} is not a file`);
  if (st.size > MAX_FILE_BYTES) throw new PolicyRefusal(`blocked by policy: ${g.rel} is larger than ${MAX_FILE_BYTES} bytes`);
  const fd = openSync(g.abs, 'r');
  try {
    const head = Buffer.alloc(Math.min(8192, st.size));
    readSync(fd, head, 0, head.length, 0);
    if (head.includes(0)) throw new PolicyRefusal(`blocked by policy: ${g.rel} is a binary file`);
  } finally {
    closeSync(fd);
  }
}
