import { EXIT, RevitionCliError, type ApiClient } from '@revition/cli-core';

import type { AppRegistration } from '../api.js';

/** T2.2.1 - the developer's own apps (GET /dev/apps; there is no single-app route). */
export async function listApps(api: ApiClient): Promise<readonly AppRegistration[]> {
  return (await api.request<{ apps: AppRegistration[] }>({ method: 'GET', path: '/dev/apps' })).body.apps;
}

/** One of the caller's apps; another developer's (or no) app is exit 4. */
export async function ownApp(api: ApiClient, appId: string): Promise<AppRegistration> {
  const app = (await listApps(api)).find((a) => a.appId === appId);
  if (app === undefined) {
    throw new RevitionCliError(
      { code: 'APP_NOT_OWNED', message: `${appId} is not one of your apps.`, hint: 'Run `revition apps list` to see your apps.' },
      EXIT.permission
    );
  }
  return app;
}

export const parseScopes = (raw: unknown): string[] =>
  typeof raw === 'string' && raw.trim() !== '' ? [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => s !== ''))].sort() : [];

/** The permission diff of a scope change. PURE. */
export function scopeDiff(current: readonly string[], next: readonly string[]): { added: string[]; removed: string[] } {
  return { added: next.filter((s) => !current.includes(s)), removed: current.filter((s) => !next.includes(s)) };
}
