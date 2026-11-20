import { mkdir, open, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * T1.3.4 - re-auth is serialized across processes: `<state>/locks/<profile>@<host>.lock`, created with O_EXCL, stale
 * after 30 s (a crashed holder). A read-only state directory falls back to an in-process lock with a warning.
 */
export const LOCK_STALE_MS = 30_000;
const memoryLocks = new Map<string, Promise<void>>();

export interface LockDeps {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly warn: (m: string) => void;
}

export async function acquireLock(stateDir: string, slot: string, deps: LockDeps, timeoutMs = 60_000): Promise<() => Promise<void>> {
  const dir = join(stateDir, 'locks');
  const file = join(dir, `${slot.replace(/[^A-Za-z0-9@._-]/g, '_')}.lock`);
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
  } catch {
    return memoryLock(slot, deps);
  }
  const started = deps.now();
  for (;;) {
    try {
      const fh = await open(file, 'wx', 0o600);
      await fh.writeFile(`${process.pid}\n`);
      await fh.close();
      return async () => {
        await rm(file, { force: true });
      };
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EROFS' || code === 'EACCES' || code === 'EPERM') return memoryLock(slot, deps);
      if (code !== 'EEXIST') throw e;
      const s = await stat(file).catch(() => null);
      if (s !== null && deps.now() - s.mtimeMs > LOCK_STALE_MS) {
        await rm(file, { force: true });
        continue;
      }
      if (deps.now() - started > timeoutMs) throw new Error(`timed out waiting for ${file}`, { cause: e });
      await deps.sleep(25 + Math.floor(Math.random() * 50));
    }
  }
}

async function memoryLock(slot: string, deps: LockDeps): Promise<() => Promise<void>> {
  deps.warn('The state directory is read-only: re-auth is serialized within this process only.');
  const prev = memoryLocks.get(slot) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const next = new Promise<void>((r) => {
    release = r;
  });
  memoryLocks.set(slot, prev.then(() => next));
  await prev;
  return async () => release();
}
