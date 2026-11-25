import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNBOOK = readFileSync(join(ROOT, 'docs', 'release', 'incident-runbook.md'), 'utf8');

/** The text of one `## <n>. ...` section. */
function section(n) {
  const m = new RegExp(`^## ${n}\\. [^\\n]+\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(RUNBOOK);
  assert.ok(m !== null, `section ${n} exists`);
  return m[1];
}

describe('T1.5.4 incident response and rollback runbook', () => {
  it('[CLI-T1.5.4-AC1] the runbook exists with the commands for each scenario', () => {
    assert.match(section(1), /npm dist-tag add @revition\/cli@<good> latest/);
    assert.match(section(1), /npm deprecate @revition\/cli@<bad> "<reason>; upgrade to <good>"/);
    assert.match(section(1), /72-hour window and only for malicious content/);
    assert.match(section(2), /GitHub Security Advisory \(GHSA\)/);
    assert.match(section(2), /raises `MIN_CLI_VERSION`/);
    assert.match(section(2), /exits 10/);
    assert.match(section(3), /revokes the affected CLI sessions and personal access tokens/);
    assert.match(section(4), /verify-release\.mjs @revition\/cli <tag>/);
    // REVITION-CLI-PLAN.md:1900 "disable release environments": every release environment the workflow uses is named
    // (T1.5.2 AC2 added release-approval-2, the second approver's environment).
    assert.match(section(4), /disable the release environments/);
    for (const env of ['npm-release', 'release-approval', 'release-approval-2']) {
      assert.match(section(4), new RegExp(`\`${env}\``));
    }
    assert.match(section(5), /Bad release:[\s\S]*Security:[\s\S]*Credential leak:/);
    assert.match(RUNBOOK, /## Drills[\s\S]*every 6 months/);
  });

  it('[CLI-T1.5.4-AC1] every step runs without a stored token', () => {
    assert.doesNotMatch(RUNBOOK, /NPM_TOKEN|NODE_AUTH_TOKEN|_authToken|--otp=\d/);
    assert.match(RUNBOOK, /without a stored token/);
  });
});
