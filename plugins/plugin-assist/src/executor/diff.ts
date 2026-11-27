/**
 * T3.3.2 - the diff shown before a write, and a strict unified-patch apply (every context and removed line must match
 * where the hunk says; otherwise the patch is stale and nothing is written).
 */

const lines = (t: string): string[] => (t === '' ? [] : t.replace(/\r\n/g, '\n').split('\n'));

/** A unified diff of one changed region (common prefix / suffix kept as context, 3 lines). PURE. */
export function unifiedDiff(rel: string, before: string | null, after: string): string {
  const a = before === null ? [] : lines(before);
  const b = lines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head = [`--- ${before === null ? '/dev/null' : `a/${rel}`}`, `+++ b/${rel}`];
  if (start === endA && start === endB) return [...head, '(no change)'].join('\n');
  const ctxFrom = Math.max(0, start - 3);
  const ctxToA = Math.min(a.length, endA + 3);
  const ctxToB = Math.min(b.length, endB + 3);
  const body = [
    ...a.slice(ctxFrom, start).map((l) => ` ${l}`),
    ...a.slice(start, endA).map((l) => `-${l}`),
    ...b.slice(start, endB).map((l) => `+${l}`),
    ...a.slice(endA, ctxToA).map((l) => ` ${l}`),
  ];
  return [...head, `@@ -${ctxFrom + 1},${ctxToA - ctxFrom} +${ctxFrom + 1},${ctxToB - ctxFrom} @@`, ...body].join('\n');
}

export class StalePatch extends Error {}

/**
 * CLI-T3.4.1 AC1 (user Assist re-run as_c0acaf92, auditor #604) — where a hunk goes. At its header's line when its old
 * lines (context and removed) are there; else at the ONE place in the file they match, as `patch` / `git apply` place
 * a hunk whose line numbers are off. The model reads files without line numbers, so a hunk dated `@@ -1` for the
 * greeting on line 2 failed "line 1 does not match the patch" twice and nothing was applied. No match, or more than
 * one, is still refused, and the reason shows the file's line beside the patch's so the next patch can be right. PURE.
 */
export function placeHunk(src: readonly string[], old: readonly string[], stated: number, from: number): number {
  const fits = (at: number): boolean => old.every((t, k) => src[at + k] === t);
  if (stated >= from && fits(stated)) return stated;
  const found: number[] = [];
  for (let at = from; at + old.length <= src.length; at++) if (fits(at)) found.push(at);
  if (found.length === 1) return found[0] as number;
  if (found.length > 1) {
    throw new StalePatch(
      `the patch's old lines match ${found.length} places (lines ${found.map((a) => a + 1).join(', ')}); add context so they match one`
    );
  }
  const k = Math.max(0, old.findIndex((t, j) => src[stated + j] !== t));
  const show = (s: string | undefined): string => JSON.stringify((s ?? '(end of file)').slice(0, 100));
  throw new StalePatch(
    `line ${stated + k + 1} does not match the patch: the file has ${show(src[stated + k])}, the patch expects ` +
      `${show(old[k])}, and its old lines match nowhere else in the file`
  );
}

/** Applies a unified patch to `before`; throws StalePatch when a hunk's old lines cannot be placed. PURE. */
export function applyUnifiedPatch(before: string, patch: string): string {
  const src = lines(before);
  const out: string[] = [];
  let pos = 0;
  const pl = patch.replace(/\r\n/g, '\n').split('\n');
  // The patch's own trailing newline(s): never blank context lines.
  while (pl.length > 0 && pl[pl.length - 1] === '') pl.pop();
  let i = 0;
  let hunks = 0;
  while (i < pl.length) {
    // A numbered header (`@@ -N,M +N,M @@`), or the bare `@@` / `@@ ... @@` a model often writes (no line numbers):
    // the hunk is then placed where its old lines match (placeHunk). File headers (`---` / `+++`) are skipped.
    const l0 = pl[i] ?? '';
    const m = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(l0);
    if (m === null && !/^@@(\s.*)?$/.test(l0)) {
      i++;
      continue;
    }
    hunks++;
    // `-N,0` inserts after line N; otherwise the hunk starts at line N.
    const stated = m === null ? 0 : Math.max(0, Number(m[1]) - (m[2] === '0' ? 0 : 1));
    i++;
    const body: { readonly tag: string; readonly text: string }[] = [];
    while (i < pl.length && !(pl[i] ?? '').startsWith('@@')) {
      const l = pl[i] ?? '';
      const tag = l[0] ?? '';
      if (tag === ' ' || tag === '-' || tag === '+') body.push({ tag, text: l.slice(1) });
      else if (l === '' && i === pl.length - 1) {
        /* the patch's trailing newline */
      } else if (l === '') body.push({ tag: ' ', text: '' }); // a blank context line that lost its leading space
      else if (!l.startsWith('\\')) throw new StalePatch(`not a patch line: ${l.slice(0, 40)}`);
      i++;
    }
    const at = placeHunk(src, body.filter((b) => b.tag !== '+').map((b) => b.text), stated, pos);
    if (at < pos) throw new StalePatch('overlapping hunks');
    out.push(...src.slice(pos, at));
    pos = at;
    for (const b of body) {
      if (b.tag === '+') out.push(b.text);
      else {
        if (b.tag === ' ') out.push(b.text);
        pos++;
      }
    }
  }
  if (hunks === 0) throw new StalePatch('no hunk in the patch');
  out.push(...src.slice(pos));
  return out.join('\n');
}
