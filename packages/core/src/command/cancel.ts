/**
 * T1.1.1 - the Ctrl-C cleanup registry (shared by the shell and first-party plugins). Cleanup is best effort and
 * bounded: the default budget is the shell's (150 ms); a cleanup that releases something billed (T2.1.4: a cloud
 * sandbox) may ask for more, capped at MAX_CLEANUP_BUDGET_MS. A second Ctrl-C skips cleanup entirely.
 */
export type Cleanup = () => void | Promise<void>;

export const MAX_CLEANUP_BUDGET_MS = 3000;
const cleanups = new Map<Cleanup, number>();

export function onCancelCleanup(fn: Cleanup, opts: { readonly budgetMs?: number } = {}): () => void {
  cleanups.set(fn, Math.min(Math.max(opts.budgetMs ?? 0, 0), MAX_CLEANUP_BUDGET_MS));
  return () => {
    cleanups.delete(fn);
  };
}

/** Runs every registered cleanup; resolves when all settle or the largest budget asked for (>= base) runs out. */
export function runCancelCleanups(baseBudgetMs: number): Promise<void> {
  const budget = Math.max(baseBudgetMs, ...cleanups.values());
  const work = Promise.allSettled([...cleanups.keys()].map(async (c) => c()));
  const deadline = new Promise((r) => setTimeout(r, budget).unref());
  return Promise.race([work, deadline]).then(() => undefined);
}
