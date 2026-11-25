import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { RevitionCliError } from '../errors/cli-error.js';

import {
  publisherFromSan,
  verifyPlugin,
  type Attestation,
  type PluginRegistry,
  type PublisherDirectory,
  type PublisherStatus,
  type RegistryKey,
  type RegistryVersion,
} from './verify.js';

/**
 * T4.2.1 (REVITION-CLI-PLAN.md:3072-3092). Offline and deterministic: the registry answers are a REAL package's recorded
 * answers (@sigstore/verify@3.1.1, published from CI with provenance on 2026-05-22), so the Sigstore verification below is
 * the real cryptography (Fulcio chain + Rekor inclusion against the pinned trusted root), not a mock of it.
 */
const here = fileURLToPath(new URL('.', import.meta.url));
const fx = (f: string): Buffer => readFileSync(join(here, 'testdata', f));
const NAME = '@sigstore/verify';
const VERSION = '3.1.1';
const PUBLISHER = 'github.com:sigstore/sigstore-js';

const versionDoc = JSON.parse(fx('sigstore-verify-3.1.1.version.json').toString('utf8')) as RegistryVersion;
const attestations = (JSON.parse(fx('sigstore-verify-3.1.1.attestations.json').toString('utf8')) as { attestations: Attestation[] }).attestations;
const keys = (JSON.parse(fx('npm-registry-keys.json').toString('utf8')) as { keys: RegistryKey[] }).keys;
const tarball = fx('sigstore-verify-3.1.1.tgz');

interface Over {
  readonly tarball?: Buffer;
  readonly attestations?: readonly Attestation[] | null;
  readonly version?: Partial<RegistryVersion>;
}

function registry(o: Over = {}): PluginRegistry {
  return {
    version: async () => ({ ...versionDoc, publishedAt: '2026-05-22T21:24:32.735Z', ...o.version }),
    attestations: async () => (o.attestations === undefined ? attestations : o.attestations),
    keys: async () => keys,
    tarball: async () => o.tarball ?? tarball,
  };
}

const publishers = (status: PublisherStatus, seen: string[] = []): PublisherDirectory => ({
  status: async (id) => {
    seen.push(id);
    return id === PUBLISHER ? status : 'unknown';
  },
});

const refusedWith = (code: string) => (e: unknown): boolean => e instanceof RevitionCliError && e.error.code === code && e.exitCode === 4;

describe('T4.2.1 plugin signing + verification', () => {
  it('[CLI-T4.2.1-AC3] a verified plugin (registry signature + Sigstore provenance + publish attestation + registered publisher) passes', async () => {
    const seen: string[] = [];
    const v = await verifyPlugin({ name: NAME, range: VERSION }, { registry: registry(), publishers: publishers('registered', seen) });
    assert.equal(v.name, NAME);
    assert.equal(v.version, VERSION);
    assert.equal(v.publisherId, PUBLISHER);
    assert.match(v.builtBy, /^https:\/\/github\.com\/sigstore\/sigstore-js\/\.github\/workflows\//u);
    assert.deepEqual(seen, [PUBLISHER], 'the publisher id comes from the provenance certificate');
  });

  it('[CLI-T4.2.1-AC1] an unsigned plugin (no provenance at all) is refused', async () => {
    await assert.rejects(
      verifyPlugin({ name: NAME, range: VERSION }, { registry: registry({ attestations: null }), publishers: publishers('registered') }),
      refusedWith('PLUGIN_UNSIGNED')
    );
  });

  it('[CLI-T4.2.1-AC1] a plugin with only the publish attestation (no SLSA provenance) is refused', async () => {
    const onlyPublish = attestations.filter((a) => a.predicateType !== 'https://slsa.dev/provenance/v1');
    await assert.rejects(
      verifyPlugin({ name: NAME, range: VERSION }, { registry: registry({ attestations: onlyPublish }), publishers: publishers('registered') }),
      refusedWith('PLUGIN_UNSIGNED')
    );
  });

  it('[CLI-T4.2.1-AC1] a tampered tarball (one byte changed) is refused before anything else', async () => {
    const bad = Buffer.from(tarball);
    bad[bad.length - 10] = (bad[bad.length - 10] ?? 0) ^ 0xff;
    await assert.rejects(
      verifyPlugin({ name: NAME, range: VERSION }, { registry: registry({ tarball: bad }), publishers: publishers('registered') }),
      refusedWith('PLUGIN_TAMPERED')
    );
  });

  it('[CLI-T4.2.1-AC1] a tampered provenance (the signed statement edited) is refused', async () => {
    const forged = attestations.map((a) => {
      if (a.predicateType !== 'https://slsa.dev/provenance/v1') return a;
      const b = JSON.parse(JSON.stringify(a.bundle)) as { dsseEnvelope: { payload: string } };
      const stmt = JSON.parse(Buffer.from(b.dsseEnvelope.payload, 'base64').toString('utf8')) as Record<string, unknown>;
      b.dsseEnvelope.payload = Buffer.from(JSON.stringify({ ...stmt, predicateType: 'https://slsa.dev/provenance/v1#forged' })).toString('base64');
      return { ...a, bundle: b };
    });
    await assert.rejects(
      verifyPlugin({ name: NAME, range: VERSION }, { registry: registry({ attestations: forged }), publishers: publishers('registered') }),
      refusedWith('PLUGIN_PROVENANCE_INVALID')
    );
  });

  it('[CLI-T4.2.1-AC1] provenance for a different package cannot be reused (subject must match name + digest)', async () => {
    await assert.rejects(
      verifyPlugin(
        { name: NAME, range: VERSION },
        { registry: registry({ version: { name: '@acme/revition-plugin-x' } }), publishers: publishers('registered') }
      ),
      (e: unknown) => e instanceof RevitionCliError && e.exitCode === 4
    );
  });

  it('[CLI-T4.2.1-AC1] a forged registry signature is refused', async () => {
    const sig = versionDoc.dist.signatures?.[0];
    assert.ok(sig);
    const forged = { ...versionDoc.dist, signatures: [{ keyid: sig.keyid, sig: Buffer.alloc(70, 1).toString('base64') }] };
    await assert.rejects(
      verifyPlugin({ name: NAME, range: VERSION }, { registry: registry({ version: { dist: forged } }), publishers: publishers('registered') }),
      refusedWith('PLUGIN_SIGNATURE_INVALID')
    );
  });

  it('[CLI-T4.2.1-AC2] a plugin from an unregistered publisher is refused', async () => {
    await assert.rejects(
      verifyPlugin({ name: NAME, range: VERSION }, { registry: registry(), publishers: publishers('unknown') }),
      refusedWith('PLUGIN_PUBLISHER_UNREGISTERED')
    );
  });

  it('[CLI-T4.2.1-AC2] a plugin whose publisher registration was revoked is refused', async () => {
    await assert.rejects(
      verifyPlugin({ name: NAME, range: VERSION }, { registry: registry(), publishers: publishers('revoked') }),
      refusedWith('PLUGIN_PUBLISHER_REVOKED')
    );
  });

  it('[CLI-T4.2.1-AC1] the publisher id is read from the certificate SAN shapes of GitHub and GitLab CI only', () => {
    assert.equal(publisherFromSan('https://github.com/acme/revition-plugin-x/.github/workflows/release.yml@refs/heads/main'), 'github.com:acme/revition-plugin-x');
    assert.equal(publisherFromSan('https://gitlab.com/acme/tools/revition-plugin-x//.gitlab-ci.yml@refs/heads/main'), 'gitlab.com:acme/tools/revition-plugin-x');
    assert.equal(publisherFromSan('mailto:dev@example.com'), null);
    assert.equal(publisherFromSan('https://evil.example/acme/x/.github/workflows/r.yml@x'), null);
  });

  it('[CLI-T4.2.1-AC1] invariant :3082 - no bypass flag, env var or option exists anywhere in the plugin code or the plugins commands', () => {
    const roots = [here, join(here, '..', '..', '..', 'cli', 'src', 'commands', 'plugins')];
    const files = roots.flatMap((r) => {
      try {
        return readdirSync(r).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => join(r, f));
      } catch {
        return [];
      }
    });
    assert.ok(files.length > 0);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      assert.doesNotMatch(src, /insecure|skip-?verif|no-?verify|allow-?unsigned|unsafe|REVITION_PLUGIN_(SKIP|ALLOW|TRUST)/iu, f);
    }
  });
});
