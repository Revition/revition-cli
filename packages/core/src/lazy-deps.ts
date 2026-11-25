import { createRequire } from 'node:module';

import type * as Keyring from '@napi-rs/keyring';
import type * as SigstoreBundle from '@sigstore/bundle';
import type * as SigstoreSpecs from '@sigstore/protobuf-specs';
import type * as SigstoreVerify from '@sigstore/verify';
import type * as Undici from 'undici';

/**
 * T1.1.1 AC6 (REVITION-CLI-PLAN.md:755, `--version` / `--help` in <= 300 ms): the HTTP client, the signature verifier and
 * the native keychain load on FIRST USE, never when the core is imported. `revition --version` and `--help` import the
 * core (the init hook, the help class) but never send a request, verify a plugin or open the keychain, so they no longer
 * pay for those libraries. Each is CommonJS, loaded once and cached by Node's own module cache: every caller gets the
 * same module object a static import would give.
 */
const load = createRequire(import.meta.url);

function onFirstUse<T>(id: string): () => T {
  let mod: T | undefined;
  return () => (mod ??= load(id) as T);
}

export const undici = onFirstUse<typeof Undici>('undici');
export const sigstoreBundle = onFirstUse<typeof SigstoreBundle>('@sigstore/bundle');
export const sigstoreSpecs = onFirstUse<typeof SigstoreSpecs>('@sigstore/protobuf-specs');
export const sigstoreVerify = onFirstUse<typeof SigstoreVerify>('@sigstore/verify');
export const keyring = onFirstUse<typeof Keyring>('@napi-rs/keyring');

/** The libraries above, by package name: what a startup must NOT have loaded (asserted by the startup test). */
export const LAZY_PACKAGES = ['undici', '@sigstore/bundle', '@sigstore/protobuf-specs', '@sigstore/verify', '@napi-rs/keyring'] as const;
