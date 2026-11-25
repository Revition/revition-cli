// T4.1.1 (REVITION-CLI-PLAN.md:2962-2985) on THIS machine's target: build the standalone binary from the current tree
// (scripts/build-sea.mjs), run the matrix smoke (scripts/sea-smoke.mjs) and assert each AC on its report. The release
// matrix runs the same smoke on every other target (L3).
//   node --test --test-timeout=900000 scripts/sea-smoke.e2e.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let report;

describe(`T4.1.1 standalone binary on ${process.platform}-${process.arch} (built from this tree)`, () => {
  before(() => {
    // SEA_BASE_NODE: an official Node.js build to embed into (a distro / Homebrew node carries no SEA fuse).
    const base = process.env.SEA_BASE_NODE ? ['--node', process.env.SEA_BASE_NODE] : [];
    const build = spawnSync(process.execPath, [join(ROOT, 'scripts', 'build-sea.mjs'), ...base], { cwd: ROOT, encoding: 'utf8', timeout: 600_000 });
    assert.equal(build.status, 0, `build-sea failed: ${(build.stderr || build.stdout).slice(-800)}`);
    const out = join(mkdtempSync(join(tmpdir(), 'sea-smoke-')), 'report.json');
    const smoke = spawnSync(process.execPath, [join(ROOT, 'scripts', 'sea-smoke.mjs'), '--report', out], { cwd: ROOT, encoding: 'utf8', timeout: 300_000 });
    report = JSON.parse(readFileSync(out, 'utf8'));
    report.smokeExit = smoke.status;
  });

  it('[CLI-T4.1.1-AC1] the binary runs --version (this version) and doctor, and doctor reports the keychain backend from the embedded addon', () => {
    assert.equal(report.ac1.versionExit, 0);
    assert.equal(report.ac1.versionMatches, true, report.ac1.versionOut);
    assert.equal(report.ac1.doctorExit, 0, 'doctor runs');
    assert.equal(report.ac1.embeddedAddon, true, JSON.stringify(report.ac1.credentialStore));
  });

  it('[CLI-T4.1.1-AC2] its cold start (median of 7 --version) is at most the npm-installed CLI\'s', () => {
    assert.ok(report.ac2.seaMedianMs <= report.ac2.npmMedianMs, `sea ${report.ac2.seaMedianMs} ms vs npm ${report.ac2.npmMedianMs} ms`);
  });

  it('[CLI-T4.1.1-AC3] its checksum is published in SHA256SUMS', () => {
    assert.equal(report.ac3.published, true, report.ac3.sha256);
  });
});
