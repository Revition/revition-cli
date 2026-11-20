/**
 * T1.1.6 - did-you-mean: `revition aps list` -> "Did you mean 'apps list'?". A suggestion only: it never runs the
 * suggested command (and there is no catch-all command, T1.1.1). PURE.
 */
export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] ?? 0;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j] ?? 0;
      prev[j] = Math.min(up + 1, (prev[j - 1] ?? 0) + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length] ?? 0;
}

/** The closest command (space-separated) to what was typed, or null when nothing is close enough. */
export function suggestCommand(typed: string, commandIds: readonly string[]): string | null {
  // oclif hands over everything typed (arguments included) as one id; only the leading words can name a command.
  const typedWords = typed.replace(/:/g, ' ').trim().toLowerCase().split(/\s+/).filter((w) => w !== '');
  if (typedWords.length === 0) return null;
  let best: { id: string; d: number; len: number } | null = null;
  for (const id of commandIds) {
    const cmdWords = id.split(':');
    const n = Math.min(cmdWords.length, typedWords.length);
    const target = cmdWords.slice(0, n).join(' ');
    const head = typedWords.slice(0, n).join(' ');
    const d = editDistance(head, target);
    // Prefer the closest; on a tie, the candidate that matches more words.
    if (best === null || d < best.d || (d === best.d && n > best.len)) best = { id: target, d, len: n };
  }
  if (best === null) return null;
  const threshold = Math.max(2, Math.floor(best.id.length / 4));
  return best.d <= threshold && best.d > 0 ? best.id : null;
}
