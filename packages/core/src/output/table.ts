/**
 * T1.1.3 - tables: auto-width columns; --plain = tab-separated with no header decoration; a column wider than the
 * terminal is truncated with an ellipsis unless --wide (T1.1.3 edge case). PURE.
 */
export interface TableOptions {
  readonly plain: boolean;
  readonly wide: boolean;
  /** Terminal width; undefined when not a TTY (no truncation). */
  readonly columns: number | undefined;
  /** ASCII fallback for non-UTF-8 terminals. */
  readonly ascii: boolean;
}

/**
 * T2.5.2 review finding 6 (Windows output): whether the terminal can draw Unicode rules and the ellipsis. POSIX
 * terminals can, except the Linux console (`TERM=linux`) and `TERM=dumb`; on Windows only the terminals known to
 * render UTF-8 can (Windows Terminal, VS Code, ConEmu / Cmder, JetBrains, CI logs, xterm-class TERM values), so a
 * legacy console gets the ASCII fallback. PURE.
 */
export function unicodeSupported(env: Readonly<Record<string, string | undefined>>, platform: string): boolean {
  const term = env['TERM'] ?? '';
  if (term === 'dumb') return false;
  if (platform !== 'win32') return term !== 'linux';
  return (
    env['CI'] !== undefined ||
    env['WT_SESSION'] !== undefined ||
    env['TERMINUS_SUBLIME'] !== undefined ||
    env['ConEmuTask'] === '{cmd::Cmder}' ||
    env['TERM_PROGRAM'] === 'vscode' ||
    env['TERMINAL_EMULATOR'] === 'JetBrains-JediTerm' ||
    term === 'xterm-256color' ||
    term === 'alacritty' ||
    term === 'rxvt-unicode' ||
    term === 'rxvt-unicode-256color'
  );
}

/** The table options for this process's stdout: plain off a terminal, its width, ASCII where Unicode is not drawn. */
export function terminalTable(
  stdout: { readonly isTTY?: boolean; readonly columns?: number } = process.stdout,
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: string = process.platform
): TableOptions {
  return { plain: stdout.isTTY !== true, wide: false, columns: stdout.columns, ascii: !unicodeSupported(env, platform) };
}

export function renderTable(
  headers: readonly string[],
  rows: readonly (readonly (string | number | boolean | null)[])[],
  opts: TableOptions
): string {
  const cells = rows.map((r) => r.map((c) => (c === null ? '' : String(c))));
  if (opts.plain) {
    return [headers.join('\t'), ...cells.map((r) => r.join('\t'))].join('\n') + '\n';
  }
  const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((r) => (r[i] ?? '').length)));
  const budget = opts.wide || opts.columns === undefined ? Infinity : opts.columns;
  const gap = 2;
  const total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1);
  if (total > budget) {
    // Shrink the widest column first until the row fits (never below 4 characters).
    let over = total - budget;
    while (over > 0) {
      const i = widths.indexOf(Math.max(...widths));
      if ((widths[i] ?? 0) <= 4) break;
      widths[i] = (widths[i] ?? 0) - 1;
      over -= 1;
    }
  }
  const ellipsis = opts.ascii ? '...' : '…';
  const fit = (s: string, w: number): string =>
    s.length <= w ? s.padEnd(w) : `${s.slice(0, Math.max(0, w - ellipsis.length))}${ellipsis}`;
  const line = (r: readonly string[]): string =>
    r
      .map((c, i) => fit(c, widths[i] ?? c.length))
      .join(' '.repeat(gap))
      .trimEnd();
  const rule = widths.map((w) => (opts.ascii ? '-' : '─').repeat(w)).join(' '.repeat(gap));
  return [line(headers.map((h) => h.toUpperCase())), rule, ...cells.map(line)].join('\n') + '\n';
}
