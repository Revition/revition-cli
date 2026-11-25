import { randomUUID } from 'node:crypto';

/** T1.1.5 - every mutation carries an Idempotency-Key, minted once per logical call and reused across its retries. */
const MUTATIONS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isMutation(method: string): boolean {
  return MUTATIONS.has(method.toUpperCase());
}

export function idempotencyKeyFor(method: string, newKey: () => string = randomUUID): string | null {
  return isMutation(method) ? newKey() : null;
}
