import { watch, type FSWatcher } from 'node:fs';

/**
 * T2.1.4 - file changes, debounced (300 ms): a burst of saves is one change. Hidden entries, node_modules and dist
 * never trigger. Returns a stop function.
 */
export const DEBOUNCE_MS = 300;

export function watchProject(dir: string, onChange: (paths: readonly string[]) => void, debounceMs = DEBOUNCE_MS): () => void {
  let timer: NodeJS.Timeout | null = null;
  const pending = new Set<string>();
  const w: FSWatcher = watch(dir, { recursive: true }, (_event, name) => {
    const p = String(name ?? '').split('\\').join('/');
    if (p === '' || p.split('/').some((s) => s.startsWith('.') || s === 'node_modules' || s === 'dist')) return;
    pending.add(p);
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const paths = [...pending].sort();
      pending.clear();
      onChange(paths);
    }, debounceMs);
  });
  return () => {
    if (timer !== null) clearTimeout(timer);
    w.close();
  };
}
