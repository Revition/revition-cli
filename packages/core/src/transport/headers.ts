/** T1.1.5 - the headers on every request. The API version is the pinned contract date. */
export const API_VERSION = '2026-10-01';

export interface HeaderInputs {
  readonly cliVersion: string;
  readonly platform: string;
  readonly nodeVersion: string;
  readonly requestId: string;
  /** Only when the request goes to the profile's own host (host binding, T09). */
  readonly accessToken: string | null;
  /** Mutations only; reused across retries of the same logical call. */
  readonly idempotencyKey: string | null;
  readonly hasBody: boolean;
  /** T3.2.2 - the audit label of the client driving the CLI ('mcp' under `revition mcp serve`); a label, never a grant. */
  readonly client?: 'mcp' | null;
}

/**
 * T3.2.2 (AC5) - `revition mcp serve` runs each tool call as the CLI with REVITION_CLIENT=mcp, so every platform call it
 * makes says `Revition-Client: mcp` and the platform audits it as client=mcp. Only that one known value is sent. PURE.
 */
export function clientLabelOf(env: Readonly<Record<string, string | undefined>>): 'mcp' | null {
  return env['REVITION_CLIENT'] === 'mcp' ? 'mcp' : null;
}

export function requestHeaders(i: HeaderInputs): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': `revition-cli/${i.cliVersion} (${i.platform}; node ${i.nodeVersion})`,
    'Revition-CLI-Version': i.cliVersion,
    'Revition-API-Version': API_VERSION,
    'X-Request-Id': i.requestId,
    Accept: 'application/json',
  };
  if (i.accessToken !== null) h['Authorization'] = `Bearer ${i.accessToken}`;
  if (i.idempotencyKey !== null) h['Idempotency-Key'] = i.idempotencyKey;
  if (i.hasBody) h['Content-Type'] = 'application/json';
  if (i.client === 'mcp') h['Revition-Client'] = 'mcp';
  return h;
}
