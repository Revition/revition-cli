import { hostname, platform, release } from 'node:os';

import type { CliScope } from '../command/contract.js';
import { CLI_SCOPES } from '../command/contract.js';
import type { ApiClient } from '../transport/client.js';

/**
 * T1.3.1 step 7 - the platform session exchange: POST /dev/cli/sessions with the Auth0 access token as the bearer
 * (the developer authorizer verifies it is the CLI's own token) -> { sessionId, credential rvs_..., authFreshUntil }.
 * The Auth0 access token is used for this one call and then discarded.
 */
export interface CreatedSession {
  readonly sessionId: string;
  readonly credential: string;
  /** Epoch ms. */
  readonly authFreshUntil: number;
}

export function deviceDescription(cliVersion: string): { deviceName: string; os: string; cliVersion: string } {
  return {
    deviceName: hostname().slice(0, 80) || 'unknown',
    os: `${platform()} ${release()}`.slice(0, 40),
    cliVersion: cliVersion.slice(0, 40),
  };
}

/** `client` must have been built with the Auth0 access token as its token provider. */
export async function createSession(
  client: ApiClient,
  input: { readonly scopes?: readonly CliScope[]; readonly devicePublicKey: string; readonly cliVersion: string }
): Promise<CreatedSession> {
  const res = await client.request<{ sessionId: string; credential: string; authFreshUntil: string }>({
    method: 'POST',
    path: '/dev/cli/sessions',
    body: {
      scopes: [...(input.scopes ?? CLI_SCOPES)],
      ...deviceDescription(input.cliVersion),
      devicePublicKey: input.devicePublicKey,
    },
  });
  return { sessionId: res.body.sessionId, credential: res.body.credential, authFreshUntil: Date.parse(res.body.authFreshUntil) };
}
