import { onCancelCleanup, runCancelCleanups } from '@revition/cli-core';

/**
 * T1.1.1 - Ctrl-C (SIGINT) exits immediately with code 11; a second Ctrl-C skips cleanup. Work is crash-only (the next
 * run cleans stale locks and temp files), so cleanup is best effort and bounded. The registry is the core's, so a
 * plugin's cleanup (T2.1.4: delete a cloud sandbox) runs too.
 */
export const CANCELLED_EXIT = 11;

export { onCancelCleanup };

export function installSigint(
  proc: Pick<NodeJS.Process, 'on' | 'exit' | 'stderr'> = process,
  cleanupBudgetMs = 150
): void {
  let interrupted = false;
  proc.on('SIGINT', () => {
    if (interrupted) proc.exit(CANCELLED_EXIT);
    interrupted = true;
    proc.stderr.write('\nCancelled.\n');
    void runCancelCleanups(cleanupBudgetMs).then(() => proc.exit(CANCELLED_EXIT));
  });
}
