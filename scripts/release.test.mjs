import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { canaryVersion, channelFor, packPublic } from './release.mjs';
import { twoApproverProblems } from './two-approvers.mjs';
import { distTagProblems, EXPECTED, provenanceProblems, SLSA_V1 } from './verify-release.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WF_DIR = join(ROOT, '.github', 'workflows');
const RELEASE = readFileSync(join(WF_DIR, 'release.yml'), 'utf8');

/** The text of one job of a workflow (from `  <name>:` to the next job). */
function job(text, name) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  assert.ok(start >= 0, `job ${name} exists`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^ {2}[a-z][a-z0-9-]*:$/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

function attestation({ repository = EXPECTED.repository, path = EXPECTED.workflowPath, name = '@revition/cli', version = '0.2.0' } = {}) {
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: `pkg:npm/${encodeURIComponent(name).replaceAll('%2F', '/')}@${version}`, digest: { sha512: 'x' } }],
    predicateType: SLSA_V1,
    predicate: { buildDefinition: { externalParameters: { workflow: { ref: 'refs/heads/main', repository, path } } } },
  };
  return { predicateType: SLSA_V1, bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString('base64') } } };
}

describe('T1.5.2 trusted publishing, provenance, channels', () => {
  it('[CLI-T1.5.2-AC1] canary: X.Y.Z-canary.<sha7> from main, published with --tag canary via OIDC (id-token) in npm-release', () => {
    assert.equal(canaryVersion('0.2.0', '0123456789abcdef0123456789abcdef01234567'), '0.2.0-canary.0123456');
    assert.equal(canaryVersion('0.2.0-next.1', 'abcdef1'), '0.2.0-canary.abcdef1');
    assert.throws(() => canaryVersion('0.2.0', 'main'));
    const canary = job(RELEASE, 'publish-canary');
    assert.match(canary, /environment: npm-release/);
    assert.match(canary, /id-token: write/);
    assert.match(canary, /npm publish "release-artifacts\/\$f" --tag canary/);
    assert.match(canary, /verify-release\.mjs @revition\/cli canary/);
    assert.match(RELEASE, /on:\n {2}push:\n {4}branches: \[main\]/);
    assert.deepEqual(provenanceProblems([attestation()], { name: '@revition/cli', version: '0.2.0' }), []);
  });

  it('[CLI-T1.5.2-AC2] stable waits for two approvals: publish needs build-stable, which needs approve-stable-2, which needs approve-stable', () => {
    const approve = job(RELEASE, 'approve-stable');
    assert.match(approve, /environment: release-approval\n/);
    assert.doesNotMatch(approve, /\$\{\{\s*secrets\.|npm publish|id-token/);
    const second = job(RELEASE, 'approve-stable-2');
    assert.match(second, /needs: \[build, approve-stable\]/);
    assert.match(second, /environment: release-approval-2\n/);
    assert.match(second, /run: node scripts\/two-approvers\.mjs/);
    assert.match(second, /permissions:\n\s+actions: read\n\s+contents: read/);
    assert.doesNotMatch(second, /\$\{\{\s*secrets\.|npm publish|id-token/);
    assert.match(job(RELEASE, 'build-stable'), /needs: approve-stable-2\n/);
    const stable = job(RELEASE, 'publish-stable');
    assert.match(stable, /needs: build-stable/);
    assert.match(stable, /environment: npm-release/);
    // the only publish steps are in the two publish jobs, both behind npm-release
    const publishJobs = ['build', 'publish-canary', 'release-pr', 'approve-stable', 'approve-stable-2', 'build-stable', 'publish-stable'].filter((j) => /npm publish/.test(job(RELEASE, j)));
    assert.deepEqual(publishJobs, ['publish-canary', 'publish-stable']);
  });

  it('[CLI-T1.5.2-AC2] one person approving both environments is refused: the publish never starts', () => {
    const approved = (login, env) => ({ state: 'approved', user: { login }, environments: [{ name: env }] });
    assert.deepEqual(twoApproverProblems([approved('ajayvarmaco', 'release-approval'), approved('ajayvarmaco', 'release-approval-2')]), [
      'the same person approved both release-approval and release-approval-2: two different people must approve',
    ]);
    assert.deepEqual(twoApproverProblems([approved('ajayvarmaco', 'release-approval')]), ['no approval in release-approval-2']);
    assert.deepEqual(twoApproverProblems([]), ['no approval in release-approval', 'no approval in release-approval-2']);
    assert.deepEqual(twoApproverProblems(null), ['no approval in release-approval', 'no approval in release-approval-2']);
  });

  it('[CLI-T1.5.2-AC2] two different people pass; a rejection never counts as an approval', () => {
    const a = (state, login, env) => ({ state, user: { login }, environments: [{ name: env }] });
    assert.deepEqual(twoApproverProblems([a('approved', 'maint-a', 'release-approval'), a('approved', 'maint-b', 'release-approval-2')]), []);
    assert.deepEqual(twoApproverProblems([a('approved', 'maint-a', 'release-approval'), a('rejected', 'maint-b', 'release-approval-2')]), [
      'no approval in release-approval-2',
    ]);
  });

  it('[CLI-T1.5.2-AC2] a canary is never tagged latest; a prerelease never latest; latest only when asked', () => {
    assert.equal(channelFor('0.2.0-canary.abcdef1', 'latest'), 'canary');
    assert.throws(() => channelFor('0.2.0-next.1', 'latest'), /never tagged latest/);
    assert.equal(channelFor('0.2.0', 'next'), 'next');
    assert.equal(channelFor('0.2.0', 'latest'), 'latest');
    assert.throws(() => channelFor('0.2.0', 'canary'));
    assert.deepEqual(distTagProblems({ latest: '0.2.0-canary.abcdef1', canary: '0.2.0-canary.abcdef1' }), [
      'latest points at a prerelease: 0.2.0-canary.abcdef1',
    ]);
    assert.deepEqual(distTagProblems({ latest: '0.2.0', canary: '0.3.0-canary.abcdef1' }), []);
  });

  it('[CLI-T1.5.2-AC3] the verification after each publish runs npm audit signatures on a fresh install of the channel', () => {
    const verify = readFileSync(join(ROOT, 'scripts', 'verify-release.mjs'), 'utf8');
    assert.match(verify, /'audit', 'signatures'/);
    assert.match(job(RELEASE, 'publish-stable'), /verify-release\.mjs @revition\/cli "\$CHANNEL"/);
    assert.deepEqual(provenanceProblems([], { name: '@revition/cli', version: '0.2.0' }), ['@revition/cli@0.2.0: no SLSA provenance attestation']);
  });

  it('[CLI-T1.5.2-AC4] a publish from a fork or another workflow is refused; no npm token exists anywhere', () => {
    const fork = provenanceProblems([attestation({ repository: 'https://github.com/someone/revition-cli' })], { name: '@revition/cli', version: '0.2.0' });
    assert.match(fork.join('\n'), /built from https:\/\/github.com\/someone\/revition-cli/);
    const other = provenanceProblems([attestation({ path: '.github/workflows/ci.yml' })], { name: '@revition/cli', version: '0.2.0' });
    assert.match(other.join('\n'), /built by \.github\/workflows\/ci\.yml/);
    const wrongPkg = provenanceProblems([attestation({ name: '@revition/other' })], { name: '@revition/cli', version: '0.2.0' });
    assert.match(wrongPkg.join('\n'), /another package/);
    for (const f of readdirSync(WF_DIR)) {
      const text = readFileSync(join(WF_DIR, f), 'utf8');
      assert.doesNotMatch(text, /NPM_TOKEN|NODE_AUTH_TOKEN|_authToken/, `${f} references an npm token`);
      if (f !== 'release.yml') assert.doesNotMatch(text, /npm publish|pnpm publish/, `${f} must not publish`);
    }
  });

  it('[CLI-T1.5.2-AC5] the GitHub Release carries the CycloneDX SBOM (and the packed tarballs)', () => {
    assert.match(job(RELEASE, 'build-stable'), /format: cyclonedx-json\n\s+output-file: release-artifacts\/sbom\.cdx\.json/);
    assert.match(job(RELEASE, 'publish-stable'), /gh release create "v\$VERSION"[\s\S]*release-artifacts\/sbom\.cdx\.json release-artifacts\/\*\.tgz/);
    assert.match(job(RELEASE, 'publish-stable'), /git tag -s "v\$VERSION"/);
  });

  it('[CLI-T1.5.2-AC1] the release dry run: pack only public packages, with a manifest; all private -> refused', () => {
    const root = mkdtempSync(join(tmpdir(), 'rel-pack-'));
    writeFileSync(join(root, 'package.json'), '{"name":"ws","private":true}\n');
    writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
    for (const [d, json] of [
      ['pub', { name: '@x/pub', version: '1.2.3', files: ['index.js'] }],
      ['priv', { name: '@x/priv', version: '1.2.3', private: true }],
    ]) {
      mkdirSync(join(root, 'packages', d), { recursive: true });
      writeFileSync(join(root, 'packages', d, 'package.json'), JSON.stringify(json));
      writeFileSync(join(root, 'packages', d, 'index.js'), 'export {};\n');
    }
    const out = join(root, 'out');
    const manifest = packPublic(root, out);
    assert.deepEqual(manifest.map((m) => [m.name, m.version]), [['@x/pub', '1.2.3']]);
    assert.ok(existsSync(join(out, manifest[0].file)));
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')), manifest);
    writeFileSync(join(root, 'packages', 'pub', 'package.json'), JSON.stringify({ name: '@x/pub', version: '1.2.3', private: true }));
    assert.throws(() => packPublic(root, join(root, 'out2')), /every package is private/);
  });
});
