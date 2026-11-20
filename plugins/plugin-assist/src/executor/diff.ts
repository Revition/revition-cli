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

/** Applies a unified patch to `before`; throws StalePatch when a hunk does not match exactly. PURE. */
export function applyUnifiedPatch(before: string, patch: string): string {
  const src = lines(before);
  const out: string[] = [];
  let pos = 0;
  const pl = patch.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  let hunks = 0;
  while (i < pl.length) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(pl[i] ?? '');
    if (m === null) {
      i++;
      continue;
    }
    hunks++;
    // `-N,0` inserts after line N; otherwise the hunk starts at line N.
    const at = Math.max(0, Number(m[1]) - (m[2] === '0' ? 0 : 1));
    if (at < pos) throw new StalePatch('overlapping hunks');
    out.push(...src.slice(pos, at));
    pos = at;
    i++;
    while (i < pl.length && !(pl[i] ?? '').startsWith('@@')) {
      const l = pl[i] ?? '';
      const tag = l[0];
      const text = l.slice(1);
      if (tag === ' ' || tag === '-') {
        if (src[pos] !== text) throw new StalePatch(`line ${pos + 1} does not match the patch`);
        if (tag === ' ') out.push(text);
        pos++;
      } else if (tag === '+') out.push(text);
      else if (l === '' && i === pl.length - 1) {
        /* the patch's trailing newline */
      } else if (!l.startsWith('\\')) throw new StalePatch(`not a patch line: ${l.slice(0, 40)}`);
      i++;
    }
  }
  if (hunks === 0) throw new StalePatch('no hunk in the patch');
  out.push(...src.slice(pos));
  return out.join('\n');
}
