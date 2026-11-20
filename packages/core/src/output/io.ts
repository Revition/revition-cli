import { LineRedactor } from '../redact/redact.js';

/**
 * The one place the CLI writes to the terminal. stdout = data only; stderr = messages, progress, warnings, prompts.
 * Both pass through the redaction layer (T1.1.4): no direct console.* anywhere else.
 */
export interface Io {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly stdoutIsTTY: boolean;
  readonly stderrIsTTY: boolean;
  readonly stdinIsTTY: boolean;
  /** Reads one line from stdin (prompts). */
  readonly readLine: (opts: { readonly hidden: boolean }) => Promise<string>;
  readonly flush: () => void;
  /**
   * The ONE unredacted path: a secret the user must see exactly once (a new token, T1.3.6 "shown ONCE, stdout only").
   * Only the pipeline calls it, for a command's declared `reveal` value; everything else stays redacted.
   */
  readonly revealOnce: (secret: string) => void;
}

export interface RawStreams {
  readonly stdout: { write: (s: string) => unknown; isTTY?: boolean };
  readonly stderr: { write: (s: string) => unknown; isTTY?: boolean };
  readonly stdin: { isTTY?: boolean };
  readonly readLine: (opts: { readonly hidden: boolean }) => Promise<string>;
}

export function createIo(streams: RawStreams): Io {
  const out = new LineRedactor((s) => {
    streams.stdout.write(s);
  });
  const err = new LineRedactor((s) => {
    streams.stderr.write(s);
  });
  return {
    out: (text) => out.write(text),
    err: (text) => err.write(text),
    stdoutIsTTY: streams.stdout.isTTY === true,
    stderrIsTTY: streams.stderr.isTTY === true,
    stdinIsTTY: streams.stdin.isTTY === true,
    readLine: streams.readLine,
    flush: () => {
      out.flush();
      err.flush();
    },
    revealOnce: (secret) => {
      out.flush();
      streams.stdout.write(`${secret}\n`);
    },
  };
}

/** An Io that records everything (tests and the leak suite). */
export function memoryIo(opts: { tty?: boolean; answers?: string[] } = {}): Io & {
  readonly stdout: () => string;
  readonly stderr: () => string;
} {
  let o = '';
  let e = '';
  const answers = [...(opts.answers ?? [])];
  const io = createIo({
    stdout: { write: (s) => (o += s), isTTY: opts.tty === true },
    stderr: { write: (s) => (e += s), isTTY: opts.tty === true },
    stdin: { isTTY: opts.tty === true },
    readLine: async () => answers.shift() ?? '',
  });
  return {
    ...io,
    stdout: () => {
      io.flush();
      return o;
    },
    stderr: () => {
      io.flush();
      return e;
    },
  };
}
