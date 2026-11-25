import { RevitionCliError, runtime, type ApiClient, type CommandContext } from '@revition/cli-core';

/**
 * The Dev API as the signed-in developer (the same session / PAT resolution as every core command). Paths are the
 * Foundry Dev API's (`/dev/...`), relative to the host's Foundry base, exactly as the core commands call them.
 */
export async function devApi(ctx: CommandContext): Promise<ApiClient> {
  const rt = await runtime(ctx);
  if (rt.session.mode === 'none') {
    throw new RevitionCliError({ code: 'AUTH_REQUIRED', message: 'You are not signed in.', hint: 'Run `revition login`.' }, 3);
  }
  return rt.session.client;
}

export const seg = (s: string): string => encodeURIComponent(s);

/** The developer portal: where the developer agreement is shown and accepted on the web. */
export const DEVELOPER_PORTAL_URL = 'https://developer.revition.com';

export interface Starter {
  readonly id: string;
  readonly title: string;
  readonly extensionPoint: string;
  readonly language: string;
  readonly cloneRef?: string;
}

export interface StarterDetail extends Starter {
  readonly files: Readonly<Record<string, string>>;
}

export interface DeveloperAccount {
  readonly developerId: string;
  readonly kind: 'tenant_member' | 'independent';
  readonly linkedOrgId: string | null;
  readonly verified: boolean;
  readonly developerWalletId: string;
  readonly agreementAccepted: boolean;
}

export interface AppRegistration {
  readonly appId: string;
  readonly manifestRef: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly declaredScopes: readonly string[];
  readonly createdAt: string;
}

export interface DevProjectMeta {
  readonly projectId: string;
  readonly name: string;
  readonly starterId: string | null;
  readonly version: number;
}
