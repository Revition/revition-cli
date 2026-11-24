/**
 * The OUTWARD live legs (auditor ruling #268, user "yes CLI outward", 2026-11-24): after each real action (a canary
 * publish, a real PR, a workflow run, a staging MIN_CLI_VERSION raise), this file READS BACK what the world now says,
 * from the registry, GitHub and the platform: never from this repo's own files. One group per run:
 *   REVITION_OUTWARD=<group>   pat-job | min-version | changesets | canary | supply-chain | drill | docs | brew | plugin
 * Group inputs (all read-only here):
 *   REVITION_OUTWARD_RUN_ID      the GitHub Actions run id the action produced (pat-job, changesets, supply-chain)
 *   REVITION_OUTWARD_PR          the real PR number (changesets: no changeset; supply-chain: the postinstall test PR)
 *   REVITION_OUTWARD_VERSION     the canary version published (canary, drill, docs)
 *   REVITION_OUTWARD_HOST        the platform host (min-version: api.revition.com)
 *   REVITION_OUTWARD_OLD_BIN     an older CLI entry (min-version: below the raised minimum)
 *   REVITION_OUTWARD_TOKEN       a cli:read PAT of the E2E developer (min-version), from memory, never printed
 * Never publishes, never merges, never writes: the action is the operator's (recorded in the step-10 row record);
 * this is its proof. Uses `gh` (authenticated) and `npm view`.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const E = process.env;
const GROUP = E['REVITION_OUTWARD'] ?? '';
const REPO = 'Revition/revition-cli';
const only = (g: string): { skip: string | false } => ({ skip: GROUP === g ? false : `REVITION_OUTWARD=${g} only` });

function gh<T>(path: string): T {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' })) as T;
}
/** `npm view <package> [field] --json`: the package spec and the field are separate arguments. */
function npmView<T>(spec: string): T {
  return JSON.parse(execFileSync('npm', ['view', ...spec.split(' '), '--json'], { encoding: 'utf8' })) as T;
}
function need(name: string): string {
  const v = E[name] ?? '';
  assert.notEqual(v, '', `${name} is required for REVITION_OUTWARD=${GROUP}`);
  return v;
}

describe('outward live legs (read-back only)', () => {
  it('[CLI-T1.3.6-AC2] [CLI-T1.3.6-AC3] [CLI-T1.3.6-AC4] a real Actions job holding a staging PAT (environment secret) ran green and never printed it', only('pat-job'), () => {
    const run = gh<{ conclusion: string; path: string; head_branch: string }>(`repos/${REPO}/actions/runs/${need('REVITION_OUTWARD_RUN_ID')}`);
    assert.equal(run.conclusion, 'success');
    assert.match(run.path, /nightly-contract\.yml$/);
    const jobs = gh<{ jobs: Array<{ conclusion: string; name: string }> }>(`repos/${REPO}/actions/runs/${need('REVITION_OUTWARD_RUN_ID')}/jobs`).jobs;
    assert.ok(jobs.length > 0 && jobs.every((j) => j.conclusion === 'success'), JSON.stringify(jobs));
    const log = execFileSync('gh', ['run', 'view', need('REVITION_OUTWARD_RUN_ID'), '--repo', REPO, '--log'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.doesNotMatch(log, /rvt_[A-Za-z0-9]{32,}/, 'no PAT in the job log');
  });

  it('[CLI-T1.4.1-AC4] the staging minimum raised: an older CLI gets the forced upgrade (exit 10) with the platform message', only('min-version'), () => {
    const r = spawnSync(process.execPath, [need('REVITION_OUTWARD_OLD_BIN'), 'whoami', '--json'], {
      env: { ...E, REVITION_HOST: need('REVITION_OUTWARD_HOST'), REVITION_TOKEN: need('REVITION_OUTWARD_TOKEN'), REVITION_NO_UPDATE_CHECK: '1' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.equal(r.status, 10, r.stdout);
    assert.equal((JSON.parse(r.stdout) as { error: { code: string } }).error.code, 'CLI_UPGRADE_REQUIRED');
  });

  it('[CLI-T1.5.1-AC1] [CLI-T1.5.1-AC2] [CLI-T1.5.1-AC3] a real PR without a changeset fails the check; the Version Packages PR exists', only('changesets'), () => {
    const runs = gh<{ check_runs: Array<{ name: string; conclusion: string }> }>(
      `repos/${REPO}/commits/${gh<{ head: { sha: string } }>(`repos/${REPO}/pulls/${need('REVITION_OUTWARD_PR')}`).head.sha}/check-runs`
    ).check_runs;
    const check = runs.find((c) => /changeset/i.test(c.name));
    assert.equal(check?.conclusion, 'failure', JSON.stringify(runs.map((c) => [c.name, c.conclusion])));
    const prs = gh<Array<{ title: string; state: string }>>(`repos/${REPO}/pulls?state=all&per_page=100`);
    assert.ok(prs.some((p) => /version packages/i.test(p.title)), 'the Version Packages PR');
  });

  it('[CLI-T1.5.2-AC1] [CLI-T1.5.2-AC4] [CLI-T1.5.2-AC5] the canary is on npm under the canary tag with provenance; latest is untouched', only('canary'), () => {
    const v = need('REVITION_OUTWARD_VERSION');
    const tags = npmView<Record<string, string>>('@revition/cli dist-tags');
    assert.equal(tags['canary'], v);
    assert.notEqual(tags['latest'], v, 'a canary never moves latest');
    const dist = npmView<{ attestations?: { provenance?: { predicateType?: string } } }>(`@revition/cli@${v} dist`);
    assert.match(String(dist.attestations?.provenance?.predicateType ?? ''), /slsa\.dev\/provenance/);
  });

  it('[CLI-T1.5.3-AC1] [CLI-T1.5.3-AC2] [CLI-T1.5.3-AC3] [CLI-T1.5.3-AC4] a postinstall dependency is refused in CI; the release carries its SBOM', only('supply-chain'), () => {
    const pr = gh<{ head: { sha: string } }>(`repos/${REPO}/pulls/${need('REVITION_OUTWARD_PR')}`);
    const runs = gh<{ check_runs: Array<{ name: string; conclusion: string }> }>(`repos/${REPO}/commits/${pr.head.sha}/check-runs`).check_runs;
    assert.ok(runs.some((c) => c.conclusion === 'failure'), 'the install-scripts gate failed the PR');
    const run = gh<{ conclusion: string }>(`repos/${REPO}/actions/runs/${need('REVITION_OUTWARD_RUN_ID')}`);
    assert.equal(run.conclusion, 'success');
    const arts = gh<{ artifacts: Array<{ name: string }> }>(`repos/${REPO}/actions/runs/${need('REVITION_OUTWARD_RUN_ID')}/artifacts`).artifacts;
    assert.ok(arts.some((a) => /sbom/i.test(a.name)), JSON.stringify(arts.map((a) => a.name)));
  });

  it('[CLI-T1.5.4-AC1] [CLI-T1.5.4-AC2] [CLI-T1.5.4-AC3] [CLI-T2.5.2-AC1] [CLI-T2.5.2-AC2] [CLI-T2.5.2-AC3] the drill on a real canary ended restored', only('drill'), () => {
    const v = need('REVITION_OUTWARD_VERSION');
    assert.equal(npmView<Record<string, string>>('@revition/cli dist-tags')['canary'], v, 'the canary tag restored');
    const meta = npmView<{ deprecated?: string }>(`@revition/cli@${v}`);
    assert.equal(meta.deprecated ?? '', '', 'the deprecation was lifted');
  });

  it('[CLI-T1.6.3-AC1] [CLI-T1.6.3-AC3] the published docs answer and a fresh install from next runs', only('docs'), () => {
    const prefix = mkdtempSync(join(tmpdir(), 'revition-next-'));
    execFileSync('npm', ['install', '-g', '--prefix', prefix, '@revition/cli@next'], { encoding: 'utf8', timeout: 300_000 });
    const out = execFileSync(join(prefix, 'bin', 'revition'), ['--version'], { encoding: 'utf8' });
    assert.match(out, /@revition\/cli\/\d+\.\d+\.\d+/);
    const pages = gh<{ status: string; html_url: string }>(`repos/${REPO}/pages`);
    assert.equal(pages.status, 'built');
  });

  it('[CLI-T4.1.5-AC1] [CLI-T4.1.5-AC2] [CLI-T4.1.5-AC3] brew installs the CLI from the tap and it runs', only('brew'), () => {
    execFileSync('brew', ['install', 'revition/tap/revition'], { encoding: 'utf8', timeout: 600_000 });
    try {
      assert.match(execFileSync('revition', ['--version'], { encoding: 'utf8' }), /@revition\/cli\/\d+\.\d+\.\d+/);
    } finally {
      execFileSync('brew', ['uninstall', 'revition'], { encoding: 'utf8' });
    }
  });

  it('[CLI-T4.2.1-AC1] [CLI-T4.2.1-AC3] the signed test plugin is on npm with provenance from this repo', only('plugin'), () => {
    const dist = npmView<{ attestations?: { provenance?: { predicateType?: string } } }>('@revition/e2e-fixture-plugin dist');
    assert.match(String(dist.attestations?.provenance?.predicateType ?? ''), /slsa\.dev\/provenance/);
  });
});
