// T4.1.5 AC2: the tap formula the release workflow writes pins each target's sha256 from SHA256SUMS (Homebrew refuses
// a download whose sha256 differs), points at the GitHub Release assets, and refuses to render with a target missing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { brewFormula } from './brew-formula.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const sum = (c) => c.repeat(64);
const SUMS = [
  `${sum('a')}  revition-darwin-arm64`,
  `${sum('b')}  revition-darwin-x64`,
  `${sum('c')}  revition-linux-arm64`,
  `${sum('d')}  revition-linux-x64`,
  `${sum('e')}  revition-win32-x64.exe`,
].join('\n');

describe('T4.1.5 the Homebrew tap formula', () => {
  it('[CLI-T4.1.5-AC2] each macOS / Linux target is pinned to its own release asset and its SHA256SUMS sha256', () => {
    const f = brewFormula({ version: '1.2.3', sums: SUMS });
    for (const [asset, c] of [['darwin-arm64', 'a'], ['darwin-x64', 'b'], ['linux-arm64', 'c'], ['linux-x64', 'd']]) {
      assert.match(f, new RegExp(`url "https://github\\.com/Revition/revition-cli/releases/download/v1\\.2\\.3/revition-${asset}"\\n\\s+sha256 "${sum(c)}"`, 'u'));
    }
    assert.match(f, /class Revition < Formula/u);
    assert.match(f, /license "Apache-2\.0"/u);
    assert.match(f, /shell_output\("#\{bin\}\/revition --version"\)/u);
    assert.doesNotMatch(f, /win32/u);
  });

  it('[CLI-T4.1.5-AC2] a SHA256SUMS missing a target, or a non-semver version, renders nothing', () => {
    assert.throws(() => brewFormula({ version: '1.2.3', sums: SUMS.replace(/^.*linux-x64$/mu, '') }), /lists no revition-linux-x64/u);
    assert.throws(() => brewFormula({ version: 'latest', sums: SUMS }), /not a semver/u);
  });

  it('[CLI-T4.1.5-AC2] the release workflow bumps the tap from the signed SHA256SUMS, only for the latest channel', () => {
    const wf = readFileSync(join(ROOT, '..', '.github', 'workflows', 'release.yml'), 'utf8');
    assert.match(wf, /if: needs\.build-stable\.outputs\.channel == 'latest'[\s\S]*node scripts\/brew-formula\.mjs --version "\$VERSION" --sums SHA256SUMS/u);
    assert.match(wf, /repos\/Revition\/homebrew-tap\/contents\/Formula\/revition\.rb/u);
  });

  it('[CLI-T4.1.5-AC3] SHA256SUMS is signed keyless and SHA256SUMS + both install scripts are attested by the release workflow', () => {
    const wf = readFileSync(join(ROOT, '..', '.github', 'workflows', 'release.yml'), 'utf8');
    assert.match(wf, /sigstore\/cosign-installer@[0-9a-f]{40}/u);
    assert.match(wf, /cosign sign-blob --yes --bundle SHA256SUMS\.sigstore\.json SHA256SUMS/u);
    assert.match(wf, /actions\/attest-build-provenance@[0-9a-f]{40}[\s\S]*subject-path: \|\s+SHA256SUMS\s+install\.sh\s+install\.ps1/u);
    assert.match(wf, /gh release upload "v\$VERSION" [^\n]*SHA256SUMS\.sigstore\.json install\.sh install\.ps1/u);
    assert.match(wf, /id-token: write\n\s+attestations: write/u);
  });
});
