/**
 * The CLI's only way to the platform: the public Foundry API, as the signed-in developer (`REVITION_TOKEN`).
 *
 * It calls exactly the routes every authoring mode uses — the starter and check routes of the Developer Portal, the
 * code-branch route (the branch the coding agent's work also lands as), and the pipeline's quote and run. It never
 * uploads, binds, approves or promotes anything: those stay behind the branch review and the pipeline.
 */

export const DEFAULT_API_URL = 'https://api.revition.com/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly reason: string | null,
    readonly details: Readonly<Record<string, unknown>>
  ) {
    super(reason === null ? `${code} (${status})` : `${code}: ${reason}`);
    this.name = 'ApiError';
  }
}

export type ProjectFiles = Readonly<Record<string, string>>;

export interface ProjectProblem {
  readonly file: string;
  readonly message: string;
}

export interface ProjectTest {
  readonly name: string;
  readonly input: unknown;
  readonly expect: unknown;
}

export interface ProjectCapability {
  readonly upload: {
    readonly id: string;
    readonly language: 'ts' | 'python' | 'wasm';
    readonly source: string;
    readonly entrypoint: string;
  };
  readonly tests: readonly ProjectTest[];
}

export interface ProjectCheck {
  readonly ok: boolean;
  readonly problems: readonly ProjectProblem[];
  readonly warnings: readonly ProjectProblem[];
  readonly buildLogs: Readonly<Record<string, readonly string[]>>;
  readonly project: { readonly capabilities: readonly ProjectCapability[] } | null;
  readonly granted: Readonly<Record<string, readonly string[]>>;
}

export interface SdkReference {
  readonly version: string;
  readonly namespaces: readonly {
    readonly name: string;
    readonly calls: readonly {
      readonly call: string;
      readonly signature: string;
      readonly permissions: readonly string[];
    }[];
  }[];
}

export interface ProposedBranch {
  readonly branch: string;
  readonly branchId: string;
  readonly files: readonly string[];
  readonly permissionDiff: readonly { readonly permission: string }[];
}

export interface PipelineQuote {
  readonly quoteId: string;
  readonly sandboxRuns: number;
  readonly limits: Readonly<Record<string, number>>;
}

export interface PipelineResult {
  readonly artifactRef: string | null;
  readonly stages: readonly {
    readonly stage: string;
    readonly status: string;
    readonly detail: string;
  }[];
}

export interface ClientOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetch?: typeof fetch;
}

const seg = (s: string): string => encodeURIComponent(s);

export class ApiClient {
  private readonly base: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly opts: ClientOptions) {
    this.base = `${opts.baseUrl.replace(/\/+$/, '')}/foundry`;
    this.doFetch = opts.fetch ?? fetch;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await this.doFetch(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.opts.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text === '' ? null : (JSON.parse(text) as unknown);
    } catch {
      json = null;
    }
    if (!res.ok) {
      const error = (json as { error?: { code?: unknown; details?: Record<string, unknown> } })
        ?.error;
      const details = error?.details ?? {};
      throw new ApiError(
        res.status,
        typeof error?.code === 'string' ? error.code : 'HTTP_ERROR',
        typeof details['reason'] === 'string' ? details['reason'] : null,
        details
      );
    }
    return json as T;
  }

  starter(starterId: string): Promise<{ readonly title: string; readonly files: ProjectFiles }> {
    return this.request('GET', `/dev/starters/${seg(starterId)}`);
  }

  check(files: ProjectFiles): Promise<ProjectCheck> {
    return this.request('POST', '/dev/authoring/check', { files });
  }

  sdkReference(): Promise<SdkReference> {
    return this.request('GET', '/dev/docs/sdk');
  }

  proposeBranch(agentId: string, files: ProjectFiles): Promise<ProposedBranch> {
    return this.request('POST', `/deployments/${seg(agentId)}/code-branches`, {
      mode: 'cli',
      files,
    });
  }

  pipelineQuote(agentId: string, branchId: string): Promise<PipelineQuote> {
    return this.request(
      'GET',
      `/deployments/${seg(agentId)}/code-branches/${seg(branchId)}/pipeline-quote`
    );
  }

  runPipeline(agentId: string, branchId: string, quoteId: string): Promise<PipelineResult> {
    return this.request(
      'POST',
      `/deployments/${seg(agentId)}/code-branches/${seg(branchId)}/pipeline`,
      { quoteId }
    );
  }
}
