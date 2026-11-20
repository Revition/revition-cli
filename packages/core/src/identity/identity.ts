/**
 * T1.3.5 - who and where the user acts. The workspace is the one the PLATFORM resolves (one active workspace per user,
 * T1.2.4): the CLI has no flag, header or setting that chooses one. Two identity kinds: a workspace member
 * (`tenant_member`) and an independent developer (no workspace: the Developer API works, workspace APIs refuse).
 */

/**
 * The workspace routes (ruling O105 / O106): the ONE list of contract paths that need a workspace. The Developer API
 * (`/dev/...`) is never one of them.
 */
export const WORKSPACE_ROUTE_PREFIXES: readonly string[] = [
  '/runtime-secrets',
  '/deployments',
  '/agent-templates',
  '/code-capabilities',
  '/release',
  '/settings',
];

export function isWorkspaceRoute(path: string): boolean {
  const p = path.split('?')[0] ?? path;
  return WORKSPACE_ROUTE_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`));
}

/** GET /dev/me (the platform's DeveloperAccount, never a token). */
export interface DeveloperMe {
  readonly developerId: string;
  readonly kind: 'tenant_member' | 'independent';
  readonly linkedOrgId: string | null;
  readonly identityRef: string;
  readonly verified: boolean;
}

export interface Identity {
  readonly user: string;
  readonly identityKind: 'workspace member' | 'developer account';
  readonly workspace: string | null;
  readonly host: string;
  readonly profile: string;
  readonly sessionId: string | null;
  readonly authFreshUntil: string | null;
  readonly method: 'browser' | 'device' | 'token';
  readonly note: string | null;
}

export function describeIdentity(
  me: DeveloperMe,
  ctx: { readonly host: string; readonly profile: string; readonly email: string | null; readonly sessionId: string | null; readonly authFreshUntil: number | null; readonly method: Identity['method'] }
): Identity {
  const workspace = me.kind === 'tenant_member' ? me.linkedOrgId : null;
  return {
    user: ctx.email ?? me.identityRef,
    identityKind: workspace === null ? 'developer account' : 'workspace member',
    workspace,
    host: ctx.host,
    profile: ctx.profile,
    sessionId: ctx.sessionId,
    authFreshUntil: ctx.authFreshUntil === null ? null : new Date(ctx.authFreshUntil).toISOString(),
    method: ctx.method,
    note:
      workspace === null
        ? 'No workspace is linked to this account: Developer API commands work; workspace commands need `revition account link-workspace`.'
        : null,
  };
}

/** The banner a mutating command prints to stderr before its confirmation (T1.3.5 AC4). */
export function actingBanner(id: Pick<Identity, 'user' | 'workspace' | 'host'>): string {
  return `Acting as ${id.user} in ${id.workspace ?? 'no workspace (developer account)'} on ${id.host}\n`;
}
