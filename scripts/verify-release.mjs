// T1.5.2 - verifies a published release (run by the release workflow after publishing, and by anyone):
//   1. the npm provenance attestation names OUR repository and OUR release workflow (a publish from a fork or another
//      workflow carries a different identity and is rejected);
//   2. a canary is never tagged `latest`;
//   3. `npm audit signatures` passes for a fresh install of the channel (registry signatures + provenance, verified by npm).
// Usage: node scripts/verify-release.mjs <package> <channel>
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXPECTED = {
  repository: 'https://github.com/Revition/revition-cli',
  workflowPath: '.github/workflows/release.yml',
};
export const SLSA_V1 = 'https://slsa.dev/provenance/v1';

/** The in-toto statement inside an npm attestation bundle (DSSE payload, base64). PURE. */
export function statementOf(attestation) {
  const payload = attestation?.bundle?.dsseEnvelope?.payload;
  if (typeof payload !== 'string') return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/** Problems with a package version's attestations against the expected publisher identity. PURE. */
export function provenanceProblems(attestations, { name, version }, expected = EXPECTED) {
  const provenance = (attestations ?? []).filter((a) => a?.predicateType === SLSA_V1);
  if (provenance.length === 0) return [`${name}@${version}: no SLSA provenance attestation`];
  const problems = [];
  for (const a of provenance) {
    const s = statementOf(a);
    const wf = s?.predicate?.buildDefinition?.externalParameters?.workflow;
    const subject = (s?.subject ?? []).map((x) => decodeURIComponent(String(x?.name ?? '')));
    if (!subject.includes(`pkg:npm/${name}@${version}`)) problems.push(`${name}@${version}: the attestation is for another package`);
    if (wf?.repository !== expected.repository) problems.push(`${name}@${version}: built from ${wf?.repository ?? 'unknown'}, not ${expected.repository}`);
    if (wf?.path !== expected.workflowPath) problems.push(`${name}@${version}: built by ${wf?.path ?? 'unknown'}, not ${expected.workflowPath}`);
  }
  return problems;
}

/** A canary on `latest` (or any prerelease on `latest`) is a release-process failure. PURE. */
export function distTagProblems(distTags) {
  const latest = distTags?.latest;
  return typeof latest === 'string' && latest.includes('-') ? [`latest points at a prerelease: ${latest}`] : [];
}

async function getJson(url) {
  const res = await globalThis.fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [name, channel = 'latest'] = process.argv.slice(2);
  const enc = encodeURIComponent(name).replace('%40', '@');
  const doc = await getJson(`https://registry.npmjs.org/${enc}`);
  const version = doc['dist-tags']?.[channel];
  if (typeof version !== 'string') throw new Error(`${name} has no ${channel} dist-tag`);
  const att = await getJson(`https://registry.npmjs.org/-/npm/v1/attestations/${enc}@${version}`);
  const problems = [...provenanceProblems(att.attestations, { name, version }), ...distTagProblems(doc['dist-tags'])];
  const dir = mkdtempSync(join(tmpdir(), 'verify-release-'));
  writeFileSync(join(dir, 'package.json'), '{"name":"verify-release","private":true}\n');
  execFileSync('npm', ['install', '--ignore-scripts', '--no-fund', '--no-audit', `${name}@${version}`], { cwd: dir, stdio: 'inherit' });
  try {
    execFileSync('npm', ['audit', 'signatures'], { cwd: dir, stdio: 'inherit' });
  } catch {
    problems.push(`npm audit signatures failed for ${name}@${version}`);
  }
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log(`verify-release: ${name}@${version} (${channel}) provenance from ${EXPECTED.workflowPath}, signatures ok`);
}
