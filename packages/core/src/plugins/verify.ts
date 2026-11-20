import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';

import { bundleFromJSON, type Bundle } from '@sigstore/bundle';
import { TrustedRoot } from '@sigstore/protobuf-specs';
import { toSignedEntity, toTrustMaterial, Verifier, type TrustMaterial } from '@sigstore/verify';

import { RevitionCliError } from '../errors/cli-error.js';
import { EXIT } from '../output/exit-codes.js';

import trustedRootJson from './sigstore-trusted-root.json' with { type: 'json' };

/**
 * T4.2.1 (REVITION-CLI-PLAN.md:3072-3092) - only signed plugins from registered publishers install. Mitigates T13.
 *
 * A plugin is an npm package. It installs only when EVERY check passes (the `npm audit signatures` checks, done here
 * through the registry API, plus the Revition publisher check):
 *   1. the downloaded tarball's sha512 equals the registry's `dist.integrity` (a tampered tarball is refused);
 *   2. the registry's ECDSA signature over `<name>@<version>:<integrity>` verifies with npm's published key that was
 *      valid when the version was published;
 *   3. a SLSA provenance attestation exists and its Sigstore bundle verifies (Fulcio certificate chain + Rekor
 *      transparency log, against the pinned Sigstore trusted root) with the in-toto subject = this package and digest;
 *   4. npm's publish attestation verifies with npm's key, for the same subject;
 *   5. the publisher identity (the source repository in the provenance CERTIFICATE, never the unsigned predicate) is
 *      registered on the Revition Developer Portal (`GET /dev/plugins/publishers/{id}`); unknown or revoked = refused.
 * There is no flag, environment variable or setting that skips any check (invariant :3082 "no bypass flag in stable
 * builds"; asserted by plugin-verify.test.ts).
 */

export const SLSA_PROVENANCE = 'https://slsa.dev/provenance/v1';
export const NPM_PUBLISH = 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1';

export interface RegistryVersion {
  readonly name: string;
  readonly version: string;
  /** ISO time the version was published (npm's key must have been valid then). */
  readonly publishedAt: string;
  readonly dist: {
    readonly tarball: string;
    readonly integrity: string;
    readonly signatures?: readonly { readonly keyid: string; readonly sig: string }[];
  };
}

export interface RegistryKey {
  readonly keyid: string;
  readonly key: string;
  readonly expires: string | null;
}

export interface Attestation {
  readonly predicateType: string;
  readonly bundle: unknown;
}

/** The npm registry, read only (the real one in registry.ts; a recorded one in tests). */
export interface PluginRegistry {
  version(name: string, range: string): Promise<RegistryVersion>;
  /** null when the registry has none for this version (an unsigned package). */
  attestations(name: string, version: string): Promise<readonly Attestation[] | null>;
  keys(): Promise<readonly RegistryKey[]>;
  tarball(url: string): Promise<Buffer>;
}

export type PublisherStatus = 'registered' | 'revoked' | 'unknown';

/** The Revition publisher registry (`GET /dev/plugins/publishers/{publisherId}`). */
export interface PublisherDirectory {
  status(publisherId: string): Promise<PublisherStatus>;
}

export interface VerifiedPlugin {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
  readonly publisherId: string;
  /** The Sigstore signer identity (the CI workflow that built it). */
  readonly builtBy: string;
  readonly tarball: Buffer;
}

export type PluginRefusal =
  | 'PLUGIN_TAMPERED'
  | 'PLUGIN_UNSIGNED'
  | 'PLUGIN_SIGNATURE_INVALID'
  | 'PLUGIN_PROVENANCE_INVALID'
  | 'PLUGIN_PUBLISHER_UNREGISTERED'
  | 'PLUGIN_PUBLISHER_REVOKED';

export function refuse(code: PluginRefusal, message: string, hint: string | null = null): RevitionCliError {
  return new RevitionCliError({ code, message, hint }, EXIT.permission);
}

/** sha512 of bytes in the SRI form npm uses (`sha512-<base64>`). PURE. */
export function sri512(bytes: Buffer): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

/** The in-toto subject name npm uses for a package (`pkg:npm/%40scope/name@1.2.3`). PURE. */
export function purl(name: string, version: string): string {
  return `pkg:npm/${name.replace(/^@/u, '%40')}@${version}`;
}

let pinnedTrust: TrustMaterial | null = null;

function trustMaterial(keys: readonly RegistryKey[]): TrustMaterial {
  pinnedTrust ??= toTrustMaterial(TrustedRoot.fromJSON(trustedRootJson));
  return {
    ...pinnedTrust,
    publicKey: (hint: string) => {
      const k = keys.find((x) => x.keyid === hint);
      if (k === undefined) throw refuse('PLUGIN_SIGNATURE_INVALID', `No npm registry key ${hint}.`);
      return {
        publicKey: npmKey(k),
        validFor: (date: Date) => k.expires === null || date.getTime() < Date.parse(k.expires),
      };
    },
  };
}

function npmKey(k: RegistryKey): KeyObject {
  return createPublicKey({ key: Buffer.from(k.key, 'base64'), format: 'der', type: 'spki' });
}

/** Check 2: npm's ECDSA signature over `<name>@<version>:<integrity>`, by a key valid at publish time. */
export function verifyRegistrySignature(v: RegistryVersion, keys: readonly RegistryKey[]): void {
  const sigs = v.dist.signatures ?? [];
  if (sigs.length === 0) throw refuse('PLUGIN_UNSIGNED', `${v.name}@${v.version} has no registry signature.`);
  const published = Date.parse(v.publishedAt);
  const ok = sigs.some((s) => {
    const k = keys.find((x) => x.keyid === s.keyid);
    if (k === undefined || (k.expires !== null && published >= Date.parse(k.expires))) return false;
    return cryptoVerify('sha256', Buffer.from(`${v.name}@${v.version}:${v.dist.integrity}`), npmKey(k), Buffer.from(s.sig, 'base64'));
  });
  if (!ok) throw refuse('PLUGIN_SIGNATURE_INVALID', `The registry signature of ${v.name}@${v.version} does not verify.`);
}

interface Statement {
  readonly subject?: readonly { readonly name?: string; readonly digest?: { readonly sha512?: string } }[];
}

function dssePayload(bundle: Bundle): Statement {
  if (bundle.content.$case !== 'dsseEnvelope') throw refuse('PLUGIN_PROVENANCE_INVALID', 'The attestation is not a DSSE envelope.');
  return JSON.parse(bundle.content.dsseEnvelope.payload.toString('utf8')) as Statement;
}

/** The statement must name exactly this package and its tarball digest. */
function assertSubject(statement: Statement, v: RegistryVersion, kind: string): void {
  const want = Buffer.from(v.dist.integrity.replace(/^sha512-/u, ''), 'base64').toString('hex');
  const hit = (statement.subject ?? []).some((s) => s.name === purl(v.name, v.version) && s.digest?.sha512 === want);
  if (!hit) throw refuse('PLUGIN_PROVENANCE_INVALID', `The ${kind} of ${v.name}@${v.version} is for a different package or tarball.`);
}

/**
 * The publisher identity from the provenance certificate's SAN (the CI workflow URI). GitHub:
 * `https://github.com/<owner>/<repo>/.github/workflows/<file>@<ref>`; GitLab: `https://gitlab.com/<path>//<file>@<ref>`.
 * Returns `<host>:<owner>/<repo>`, or null for any other shape. PURE.
 */
export function publisherFromSan(san: string): string | null {
  const gh = /^https:\/\/(github\.com)\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\/\.github\/workflows\//u.exec(san);
  if (gh !== null) return `${gh[1]}:${gh[2]}`;
  const gl = /^https:\/\/(gitlab\.com)\/([A-Za-z0-9._/-]+?)\/\//u.exec(san);
  if (gl !== null) return `${gl[1]}:${gl[2]}`;
  return null;
}

/** Checks 3 and 4: both attestations verify; returns the signer's workflow identity and the publisher. */
export function verifyAttestations(
  v: RegistryVersion,
  attestations: readonly Attestation[] | null,
  keys: readonly RegistryKey[]
): { publisherId: string; builtBy: string } {
  const provenance = attestations?.find((a) => a.predicateType === SLSA_PROVENANCE);
  const publish = attestations?.find((a) => a.predicateType === NPM_PUBLISH);
  if (provenance === undefined || publish === undefined) {
    throw refuse(
      'PLUGIN_UNSIGNED',
      `${v.name}@${v.version} has no provenance; only signed plugins install.`,
      'Ask the publisher to publish with `npm publish --provenance` from CI.'
    );
  }
  const verifier = new Verifier(trustMaterial(keys));
  let builtBy: string;
  try {
    const bundle = bundleFromJSON(provenance.bundle);
    const signer = verifier.verify(toSignedEntity(bundle));
    assertSubject(dssePayload(bundle), v, 'provenance');
    builtBy = signer.identity?.subjectAlternativeName ?? '';
    const pub = bundleFromJSON(publish.bundle);
    verifier.verify(toSignedEntity(pub));
    assertSubject(dssePayload(pub), v, 'publish attestation');
  } catch (e) {
    if (e instanceof RevitionCliError) throw e;
    throw refuse('PLUGIN_PROVENANCE_INVALID', `The provenance of ${v.name}@${v.version} does not verify: ${(e as Error).message}`);
  }
  const publisherId = publisherFromSan(builtBy);
  if (publisherId === null) {
    throw refuse('PLUGIN_PROVENANCE_INVALID', `${v.name}@${v.version} was not built by a recognised CI workflow (${builtBy}).`);
  }
  return { publisherId, builtBy };
}

/** Every check, in order; any failure refuses (nothing is written before this returns). */
export async function verifyPlugin(
  spec: { readonly name: string; readonly range: string },
  deps: { readonly registry: PluginRegistry; readonly publishers: PublisherDirectory }
): Promise<VerifiedPlugin> {
  const v = await deps.registry.version(spec.name, spec.range);
  const tarball = await deps.registry.tarball(v.dist.tarball);
  if (sri512(tarball) !== v.dist.integrity) {
    throw refuse('PLUGIN_TAMPERED', `The downloaded ${v.name}@${v.version} does not match the registry's integrity hash.`);
  }
  const keys = await deps.registry.keys();
  verifyRegistrySignature(v, keys);
  const { publisherId, builtBy } = verifyAttestations(v, await deps.registry.attestations(v.name, v.version), keys);
  const status = await deps.publishers.status(publisherId);
  if (status === 'revoked') throw refuse('PLUGIN_PUBLISHER_REVOKED', `The publisher ${publisherId} is no longer registered with Revition.`);
  if (status !== 'registered') {
    throw refuse(
      'PLUGIN_PUBLISHER_UNREGISTERED',
      `${v.name} is published by ${publisherId}, which is not a registered Revition plugin publisher.`,
      'Publishers register on the Revition Developer Portal.'
    );
  }
  return { name: v.name, version: v.version, integrity: v.dist.integrity, publisherId, builtBy, tarball };
}
