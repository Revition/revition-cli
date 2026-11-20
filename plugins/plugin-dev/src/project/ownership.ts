import { EXIT, RevitionCliError, type ApiClient } from '@revition/cli-core';

import { seg, type AppRegistration, type DevProjectMeta } from '../api.js';

/**
 * T2.1.1 - ownership is the server's answer, never the client's guess: an app must be in the caller's own
 * GET /dev/apps (there is no single-app route), and a cloud project must be readable by the caller
 * (GET /dev/projects/{id} is scoped to the developer's own partition). Anything else: exit 4.
 */
export async function assertOwnedApp(api: ApiClient, appId: string): Promise<string> {
  const apps = (await api.request<{ apps: readonly AppRegistration[] }>({ method: 'GET', path: '/dev/apps' })).body.apps;
  if (!apps.some((a) => a.appId === appId)) {
    throw new RevitionCliError(
      { code: 'APP_NOT_OWNED', message: `${appId} is not one of your apps.`, hint: 'Run `revition apps list` to see your apps.' },
      EXIT.permission
    );
  }
  return appId;
}

export async function assertOwnedProject(api: ApiClient, projectId: string): Promise<string> {
  try {
    return (await api.request<DevProjectMeta>({ method: 'GET', path: `/dev/projects/${seg(projectId)}` })).body.projectId;
  } catch (e) {
    // 403 -> exit 4 and 404 -> exit 5 from the transport: either way it is not the caller's project.
    if (e instanceof RevitionCliError && (e.exitCode === EXIT.permission || e.exitCode === EXIT.notFound)) {
      throw new RevitionCliError({ code: 'PROJECT_NOT_OWNED', message: `${projectId} is not one of your cloud projects.` }, EXIT.permission);
    }
    throw e;
  }
}
