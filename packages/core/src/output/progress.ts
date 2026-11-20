import type { Io } from './io.js';

/**
 * T1.1.3 - progress. TTY and not --json: a textual progress line; braille spinner frames only when animation is
 * allowed (never with TERM=dumb or REVITION_ACCESSIBLE=1). Non-TTY: no animation, periodic plain lines. Always stderr.
 */
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

export function animationAllowed(env: Readonly<Record<string, string | undefined>>, io: Io, json: boolean): boolean {
  if (json || !io.stderrIsTTY) return false;
  if (env['TERM'] === 'dumb') return false;
  if (env['REVITION_ACCESSIBLE'] === '1') return false;
  return true;
}

export interface Progress {
  update(message: string): void;
  done(message: string): void;
}

export function startProgress(
  io: Io,
  env: Readonly<Record<string, string | undefined>>,
  json: boolean,
  message: string
): Progress {
  if (json) return { update: () => undefined, done: () => undefined };
  const animate = animationAllowed(env, io, json);
  let frame = 0;
  const line = (m: string): string => (animate ? `${SPINNER_FRAMES[frame++ % SPINNER_FRAMES.length]} ${m}` : m);
  io.err(`${line(message)}\n`);
  return {
    update: (m) => io.err(`${line(m)}\n`),
    done: (m) => io.err(`${m}\n`),
  };
}
