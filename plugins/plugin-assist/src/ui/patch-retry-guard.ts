import type { ToolResult } from '../executor/executor.js';

interface Req {
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
}

const WRITES = new Set(['apply_patch', 'write_file']);
const READS = new Set(['read_file', 'list_dir']);
const DECLINED = 'declined by the developer';

const keyOf = (r: Req): string => `${r.tool}:${typeof r.args['path'] === 'string' ? r.args['path'] : '.'}`;

/**
 * CLI-T3.4.1 AC1 (user Assist re-run as_c0acaf92, auditor #604): after a patch failed, the model re-read main.ts and
 * tests.json about 35 times without sending another patch. Once a write has failed, a read the session already made
 * since that failure is NOT run again: the model gets the write's error back with what to do instead. Any other read,
 * a successful write, or a write the developer declined (their decision, not an error) clears nothing it should not.
 */
export class PatchRetryGuard {
  private failure: { readonly path: string; readonly error: string } | null = null;
  private readonly seen = new Set<string>();

  /** The answer instead of running `req`, or null to run it. */
  check(req: Req): ToolResult | null {
    if (this.failure === null || !READS.has(req.tool) || !this.seen.has(keyOf(req))) return null;
    return {
      tool: req.tool,
      ok: false,
      error:
        `already read since the change to ${this.failure.path} failed (${this.failure.error}). Do not read it ` +
        'again: send a corrected apply_patch whose old lines are exactly as the file has them, or write_file with ' +
        'the whole new content.',
    };
  }

  /** Records what a request did. */
  note(req: Req, res: ToolResult): void {
    if (WRITES.has(req.tool)) {
      if (res.ok) {
        this.failure = null;
        this.seen.clear();
      } else if (res.error !== undefined && res.error !== DECLINED) {
        this.failure = { path: typeof req.args['path'] === 'string' ? req.args['path'] : '(unknown)', error: res.error };
        this.seen.clear();
      }
      return;
    }
    if (this.failure !== null && READS.has(req.tool) && res.ok) this.seen.add(keyOf(req));
  }
}
