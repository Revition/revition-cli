// T1.5.2 - verifies a published release (run by the release workflow after publishing, and by anyone):
//   1. the npm provenance attestation names OUR repository and OUR release workflow (a publish from a fork or another
//      workflow carries a different identity and is rejected);
//   2. a canary is never tagged `latest`;
//   3. `npm audit signatures` passes for a fresh install of the channel (registry signatures + provenance, verified by npm).
// Usage: node scripts/verify-release.mjs <package> <channel>
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

/** Is `version` of a package visible on the channel: the dist-tag points at it and its version document exists. PURE. */
export function isPublished(doc, channel, version) {
  const tagged = doc?.['dist-tags']?.[channel];
  if (version === undefined) return typeof tagged === 'string';
  return tagged === version && doc?.versions?.[version] !== undefined;
}

// npm answers a publish with "Your package is being processed and may take a few minutes to become available": the
// version reaches the registry asynchronously (run 45989396956: plugin-dev visible 4 min after its publish, plugin-assist
// later). A read right after the publish loop is a race, so every check first waits for the version, BOUNDED.
export const WAIT = { attempts: 40, delayMs: 15_000 };

/**
 * Wait until every `{ name, version }` is visible on `channel`, re-reading the registry up to `attempts` times. Returns
 * each package's registry document; throws naming every package still missing (never waits forever).
 */
export async function waitForPublished(packages, channel, { getDoc, sleep, attempts = WAIT.attempts, delayMs = WAIT.delayMs }) {
  const docs = new Map();
  let missing = [...packages];
  for (let i = 1; i <= attempts; i += 1) {
    const still = [];
    for (const p of missing) {
      let doc = null;
      try {
        doc = await getDoc(p.name);
      } catch {
        doc = null; // a 404 for a first publish, or a transient registry error: read it again on the next attempt
      }
      if (isPublished(doc, channel, p.version)) docs.set(p.name, doc);
      else still.push(p);
    }
    missing = still;
    if (missing.length === 0) return docs;
    if (i < attempts) await sleep(delayMs);
  }
  const list = missing.map((p) => `${p.name}@${p.version ?? '?'}`).join(', ');
  throw new Error(`not visible on the ${channel} dist-tag after ${attempts} reads ${delayMs / 1000} s apart: ${list}`);
}

async function getJson(url) {
  const res = await globalThis.fetch(url, { headers: { accept: 'application/json', 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

const encName = (name) => encodeURIComponent(name).replace(/^%40/u, '@');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // node scripts/verify-release.mjs <package> <channel> [--manifest <release-artifacts/manifest.json>]
  const args = process.argv.slice(2);
  const at = args.indexOf('--manifest');
  const manifestPath = at >= 0 ? args[at + 1] : undefined;
  const [name, channel = 'latest'] = args.filter((_, i) => at < 0 || (i !== at && i !== at + 1));
  // Every package of the release (the CLI depends on each plugin at its exact version, so one missing plugin fails the
  // install below); without a manifest, only the named package at whatever its channel points to.
  const manifest = manifestPath === undefined ? [{ name }] : JSON.parse(readFileSync(manifestPath, 'utf8'));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const docs = await waitForPublished(manifest, channel, { getDoc: (n) => getJson(`https://registry.npmjs.org/${encName(n)}`), sleep });
  const problems = [];
  for (const p of manifest) {
    const v = docs.get(p.name)['dist-tags'][channel];
    const att = await getJson(`https://registry.npmjs.org/-/npm/v1/attestations/${encName(p.name)}@${v}`);
    problems.push(...provenanceProblems(att.attestations, { name: p.name, version: v }), ...distTagProblems(docs.get(p.name)['dist-tags']));
  }
  const version = docs.get(name)?.['dist-tags']?.[channel];
  if (typeof version !== 'string') throw new Error(`${name} has no ${channel} dist-tag`);
  const dir = mkdtempSync(join(tmpdir(), 'verify-release-'));
  writeFileSync(join(dir, 'package.json'), '{"name":"verify-release","private":true}\n');
  execFileSync('npm', ['install', '--ignore-scripts', '--no-fund', '--no-audit', `${name}@${version}`], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
  try {
    execFileSync('npm', ['audit', 'signatures'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
  } catch {
    problems.push(`npm audit signatures failed for ${name}@${version}`);
  }
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log(`verify-release: ${name}@${version} (${channel}) provenance from ${EXPECTED.workflowPath}, signatures ok`);
}
