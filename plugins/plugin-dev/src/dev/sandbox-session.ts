import { EXIT, RevitionCliError, type ApiClient } from '@revition/cli-core';

import { seg } from '../api.js';

/**
 * T2.1.4 - the cloud sandbox for one project (devportal/sandbox/dev-sandbox.ts): one session per project, metered to
 * the developer wallet; the platform stops it after 5 idle minutes and at most 20 minutes after it starts. The sandbox
 * runs the SAVED files, so every action saves first. A save from an older version is refused by the platform
 * (409 AGENT_STATE_CONFLICT): another editor saved, and nothing is overwritten.
 */
export interface SandboxSessionView {
  readonly sessionId: string;
  readonly projectId: string;
  readonly tier: string;
  readonly provider: string;
  readonly expiresAt: string;
  readonly resumed: boolean;
}

export interface RunResult {
  readonly ok: boolean;
  readonly output?: unknown;
  readonly message?: string;
  readonly logs: readonly string[];
  readonly wallMs: number;
}

export type Action =
  | { readonly kind: 'run'; readonly capabilityId: string; readonly input: unknown }
  | { readonly kind: 'test'; readonly capabilityId: string }
  | { readonly kind: 'exec'; readonly command: string };

export class SandboxSession {
  private version: number;

  constructor(
    private readonly api: ApiClient,
    readonly projectId: string,
    baseVersion: number
  ) {
    this.version = baseVersion;
  }

  get baseVersion(): number {
    return this.version;
  }

  static async open(api: ApiClient, projectId: string): Promise<{ session: SandboxSession; view: SandboxSessionView }> {
    const project = (await api.request<{ version: number }>({ method: 'GET', path: `/dev/projects/${seg(projectId)}` })).body;
    const view = (await api.request<SandboxSessionView>({ method: 'POST', path: `/dev/projects/${seg(projectId)}/sandbox` })).body;
    return { session: new SandboxSession(api, projectId, project.version), view };
  }

  /** Saves the whole file set from the last known version; a 409 means someone else saved first. */
  async save(files: Readonly<Record<string, string>>): Promise<number> {
    try {
      const meta = (await this.api.request<{ version: number }>({ method: 'PUT', path: `/dev/projects/${seg(this.projectId)}/files`, body: { files, baseVersion: this.version } })).body;
      this.version = meta.version;
      return meta.version;
    } catch (e) {
      if (e instanceof RevitionCliError && e.exitCode === EXIT.conflict) {
        throw new RevitionCliError(
          {
            code: 'PROJECT_CHANGED_ELSEWHERE',
            message: 'Another editor saved this project since you started: nothing was overwritten.',
            hint: 'Reload the project (`revition dev --pull`) and apply your change again.',
          },
          EXIT.conflict
        );
      }
      throw e;
    }
  }

  async act(a: Action): Promise<unknown> {
    const base = `/dev/projects/${seg(this.projectId)}/sandbox`;
    if (a.kind === 'run') return (await this.api.request<RunResult>({ method: 'POST', path: `${base}/run`, body: { capabilityId: a.capabilityId, input: a.input } })).body;
    if (a.kind === 'test') return (await this.api.request({ method: 'POST', path: `${base}/test`, body: { capabilityId: a.capabilityId } })).body;
    return (await this.api.request({ method: 'POST', path: `${base}/exec`, body: { command: a.command } })).body;
  }

  async dispose(): Promise<void> {
    await this.api.request({ method: 'DELETE', path: `/dev/projects/${seg(this.projectId)}/sandbox` });
  }
}
