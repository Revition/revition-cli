import type { CommandContext, HumanView } from '@revition/cli-core';

/** T2.2.2 - a developer key as the platform shows it (never the secret, which only creation / rotation return). */
export interface KeyView {
  readonly keyId: string;
  readonly appId: string;
  readonly scopes: readonly string[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revokeAt: string | null;
}

export interface IssuedKey {
  readonly keyId: string;
  readonly appId: string;
  readonly scopes: readonly string[];
  readonly expiresAt: string;
  /** The key itself (`rdk_<keyId>_<secret>`): shown exactly once, never written to disk by the CLI. */
  readonly secret: string;
}

export function issued(body: { key: string; view: KeyView }): IssuedKey {
  return { keyId: body.view.keyId, appId: body.view.appId, scopes: body.view.scopes, expiresAt: body.view.expiresAt, secret: body.key };
}

/** The once-only warning: under --json a warning naming data.secret; on a terminal a line on stderr. */
export function warnOnce(ctx: CommandContext): void {
  if (ctx.flags.json) ctx.warn('data.secret is shown once: store it now; it will not be shown again.');
  else if (ctx.io.stdoutIsTTY) ctx.io.err('Store this now; it will not be shown again.\n');
}

/** Human output: the secret alone on stdout, through the one unredacted path. */
export const revealView = (k: IssuedKey): HumanView => ({ text: '', reveal: k.secret });
