/** T3.3.3 - the commands typed inside a session. */
export type SlashCommand = 'diff' | 'undo' | 'cost' | 'permissions' | 'exit' | 'help';

export const SLASH_HELP = [
  '/diff         the last change applied',
  '/undo         revert the last applied change (from its local backup)',
  '/cost         what the session has spent, against its budget',
  '/permissions  what the assistant may do on this machine',
  '/exit         end the session',
].join('\n');

/** A typed line's command, `unknown` for an unknown `/word`, or null for a message to the assistant. PURE. */
export function parseSlash(line: string): SlashCommand | 'unknown' | null {
  const t = line.trim();
  if (!t.startsWith('/')) return null;
  const word = t.slice(1).split(/\s+/)[0] ?? '';
  return (['diff', 'undo', 'cost', 'permissions', 'exit', 'help'] as const).find((c) => c === word) ?? 'unknown';
}
