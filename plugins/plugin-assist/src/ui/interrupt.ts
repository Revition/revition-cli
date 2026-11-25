/**
 * T3.3.3 - stopping a session. While a turn is in flight on a terminal, Esc or Ctrl-C (read in raw mode, so the shell's
 * own Ctrl-C exit does not cut the turn off) asks the session to stop: no further turn is sent, and the turn already
 * in flight is awaited, its charge shown.
 */
export interface KeyInput {
  readonly isTTY?: boolean;
  setRawMode?(raw: boolean): unknown;
  on(event: 'data', fn: (b: Buffer) => void): unknown;
  off(event: 'data', fn: (b: Buffer) => void): unknown;
  resume(): unknown;
  pause(): unknown;
}

export const ESC = 0x1b;
export const CTRL_C = 0x03;

export class StopSignal {
  private stopped = false;

  get requested(): boolean {
    return this.stopped;
  }

  request(): void {
    this.stopped = true;
  }

  /** Watches the keyboard (a TTY only) until the returned function is called. */
  watchKeys(input: KeyInput, onStop: () => void): () => void {
    if (input.isTTY !== true || input.setRawMode === undefined) return () => undefined;
    const fn = (b: Buffer): void => {
      if (b.includes(ESC) || b.includes(CTRL_C)) {
        if (!this.stopped) onStop();
        this.request();
      }
    };
    input.setRawMode(true);
    input.on('data', fn);
    input.resume();
    return () => {
      input.off('data', fn);
      input.setRawMode?.(false);
      input.pause();
    };
  }
}
