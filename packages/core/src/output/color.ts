/**
 * T1.1.3 - colour: --color=auto|always|never; NO_COLOR disables; no ANSI when not a TTY unless --color=always. Colour
 * never carries meaning on its own: every coloured status is also a word ("ok", "warn", "failed").
 */
export type ColorFlag = 'auto' | 'always' | 'never';

export interface ColorInputs {
  readonly flag: ColorFlag | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly isTTY: boolean;
}

/** Whether ANSI colour is used. PURE. */
export function useColor({ flag, env, isTTY }: ColorInputs): boolean {
  if (flag === 'always') return true;
  if (flag === 'never') return false;
  if (env['NO_COLOR'] !== undefined && env['NO_COLOR'] !== '') return false;
  if (env['TERM'] === 'dumb') return false;
  return isTTY;
}

const CODES = { red: 31, green: 32, yellow: 33, dim: 2, bold: 1 } as const;
export type Style = keyof typeof CODES;

export function paint(text: string, style: Style, enabled: boolean): string {
  return enabled ? `\u001b[${CODES[style]}m${text}\u001b[0m` : text;
}

/** A status label that reads without colour. */
export function status(kind: 'ok' | 'warn' | 'fail', enabled: boolean): string {
  if (kind === 'ok') return paint('ok', 'green', enabled);
  if (kind === 'warn') return paint('warn', 'yellow', enabled);
  return paint('failed', 'red', enabled);
}

// eslint-disable-next-line no-control-regex -- matching ANSI escapes is the point
const ANSI = /\u001b\[[0-9;]*m/g;
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}
export function hasAnsi(text: string): boolean {
  return new RegExp(ANSI.source).test(text);
}
