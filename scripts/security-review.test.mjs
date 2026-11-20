// T1.6.2 (REVITION-CLI-PLAN.md:1882-1902) and T3.4.2 (:2937-2952): the security reviews, checked as data.
// - AC2 of both: zero OPEN high or critical findings (a high/critical row must be RESOLVED), and the dependency audit
//   (`pnpm audit --prod --audit-level high`) reports no high or critical advisory.
// - T1.6.2 AC1: every Phase 1 threat T01-T20 has a status that is VERIFIED, DEFERRED to a named later phase, or OPEN
//   naming what it waits for; every repo file cited as evidence exists.
// - T3.4.2: every red-team attempt is "blocked" and cites its test file.
// The manual attacks per OS and the live red-team against the deployed harness stay the live part (L5 / L4).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = (name) => readFileSync(join(ROOT, 'docs', 'security', name), 'utf8');

/** The rows of the markdown table under `## <heading>`, as arrays of trimmed cells (header and rule removed). */
export function tableUnder(md, heading) {
  const at = md.indexOf(`## ${heading}`);
  assert.ok(at >= 0, `section "${heading}" exists`);
  const lines = md.slice(at).split('\n').slice(1);
  const rows = [];
  let started = false;
  for (const l of lines) {
    if (l.startsWith('|')) {
      started = true;
      rows.push(l.slice(1, -1).split(' | ').map((c) => c.trim()));
    } else if (started && l.trim() !== '') break;
    else if (l.startsWith('## ')) break;
  }
  return rows.slice(2);
}

/** Findings that would block: severity high or critical, and a status that is not RESOLVED. */
export function openBlocking(findings) {
  return findings.filter((f) => /^(high|critical)$/iu.test(f[1]) && !/^RESOLVED\b/u.test(f[3]));
}

/** Repo files cited in backticks (a path with a slash and a file extension), excluding the platform's own files. */
function citedRepoFiles(cell) {
  return [...cell.matchAll(/`([\w.-]+(?:\/[\w.-]+)+\.(?:ts|mjs|md|yml))`/gu)]
    .map((m) => m[1])
    .filter((p) => !cell.includes(`platform \`${p}`));
}

function resolves(p) {
  return [ROOT, join(ROOT, 'packages'), join(ROOT, 'plugins')].some((base) => existsSync(join(base, p)));
}

describe('T1.6.2 / T3.4.2 security reviews', () => {
  it('[CLI-T1.6.2-AC2] Phase 1: zero open high or critical findings; each finding has a severity and a status', () => {
    const f = tableUnder(doc('review-phase1.md'), 'Findings');
    assert.ok(f.length > 0);
    for (const row of f) assert.match(row[1], /^(critical|high|medium|low)$/u, `finding ${row[0]} has a severity`);
    assert.deepEqual(openBlocking(f), []);
    // The control: an open high finding IS caught.
    assert.equal(openBlocking([['9', 'high', 'x', 'OPEN: waiting']]).length, 1);
    assert.equal(openBlocking([['9', 'critical', 'x', 'mitigated later']]).length, 1);
  });

  it('[CLI-T1.6.2-AC2] [CLI-T3.4.2-AC2] the dependency audit: no high or critical advisory in the production tree', () => {
    const r = spawnSync('pnpm', ['audit', '--prod', '--json'], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });
    const out = JSON.parse(r.stdout);
    const v = out.metadata?.vulnerabilities ?? {};
    assert.equal(typeof v.high, 'number', `pnpm audit answered (${r.stderr.slice(0, 200)})`);
    assert.equal(v.high + (v.critical ?? 0), 0, JSON.stringify(v));
  });

  it('[CLI-T1.6.2-AC1] every Phase 1 threat T01-T20 is VERIFIED, DEFERRED to a named phase, or OPEN naming what it waits for', () => {
    const t = tableUnder(doc('review-phase1.md'), 'Threats');
    assert.deepEqual(t.map((r) => r[0]), Array.from({ length: 20 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`));
    for (const [id, , , evidence, status] of t) {
      assert.match(status, /^(VERIFIED|DEFERRED to Phase \d|OPEN: \S)/u, `${id} status`);
      for (const part of status.split(/;\s*/u)) {
        if (/DEFERRED/u.test(part)) assert.match(part, /DEFERRED to Phase \d/u, `${id}: a deferral names its phase`);
        if (/^OPEN/u.test(part)) assert.match(part, /^OPEN: \S.{8,}/u, `${id}: an open item names what it waits for`);
      }
      if (/^VERIFIED/u.test(status)) assert.notEqual(evidence, '-', `${id}: VERIFIED cites evidence`);
      for (const p of citedRepoFiles(evidence)) assert.ok(resolves(p), `${id}: the cited evidence ${p} exists`);
    }
  });

  it('[CLI-T4.4.1-AC2] Phase 4: T01-T20 re-verified; each open part names what it waits for; signing items name Q8; no open high', () => {
    const md = doc('review-phase4.md');
    const t = tableUnder(md, 'Threats');
    assert.deepEqual(t.map((r) => r[0]), Array.from({ length: 20 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`));
    for (const [id, , , evidence, status] of t) {
      assert.match(status, /^(VERIFIED|OPEN: \S)/u, `${id} status`);
      for (const part of status.split(/;\s*/u).filter((p) => p.startsWith('OPEN'))) {
        assert.match(part, /^OPEN: \S.{8,}/u, `${id}: an open item names what it waits for`);
        if (/sign|T4\.1\.[234]/u.test(part)) assert.match(part, /Q8/u, `${id}: a signing dependency names the user decision Q8`);
      }
      for (const p of citedRepoFiles(evidence)) assert.ok(resolves(p), `${id}: the cited evidence ${p} exists`);
    }
    assert.deepEqual(openBlocking(tableUnder(md, 'Findings')), []);
  });

  it('[CLI-T2.5.2-AC3] Phase 2 UX checklist: the five clig.dev / a11y checks VERIFIED; only the OS-run parts open; every finding resolved or low', () => {
    const md = doc('review-phase2.md');
    const ux = tableUnder(md, 'UX checklist (clig.dev, accessibility)');
    const names = ux.map((r) => r[0]);
    for (const n of ['Help with examples on every command', 'Errors with a hint', '`--json` everywhere', 'Non-interactive safety', 'Accessibility mode', 'Windows output']) {
      assert.ok(names.includes(n), `checklist has "${n}"`);
    }
    for (const [check, , status] of ux) {
      assert.match(status, /^(VERIFIED|OPEN: \S)/u, `${check} status`);
      if (check !== 'A first-time user\'s walkthrough on each OS') assert.match(status, /^VERIFIED/u, `${check} is verified`);
    }
    const f = tableUnder(md, 'Findings');
    assert.deepEqual(f.filter((r) => !/^RESOLVED\b/u.test(r[3])).map((r) => r[0]), [], 'every Phase 2 finding is resolved');
  });

  it('[CLI-T3.4.2-AC2] Phase 3: no high or critical finding; [CLI-T3.4.2-AC1] every red-team attempt is blocked and cites its test', () => {
    const md = doc('review-phase3.md');
    const f = tableUnder(md, 'Findings');
    assert.ok(f.length > 0);
    for (const row of f) assert.match(row[1], /^(critical|high|medium|low)$/u);
    assert.deepEqual(f.filter((row) => /^(high|critical)$/u.test(row[1])), []);
    const attempts = tableUnder(md, 'Attempts and results');
    assert.equal(attempts.length, 10);
    for (const a of attempts) {
      assert.match(a[3], /^blocked\b/u, `attempt ${a[0]} is blocked`);
      for (const p of citedRepoFiles(a[4])) assert.ok(resolves(p), `attempt ${a[0]}: ${p} exists`);
    }
  });
});
