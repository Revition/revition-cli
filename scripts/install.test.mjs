// T4.1.5 (REVITION-CLI-PLAN.md:3047-3068): install.sh, run for real against a loopback "test bucket". The signature
// tools are FAKES on a restricted PATH (the real cosign / gh are never reached), so each case pins the script's own
// decision: a tampered asset installs nothing (AC1), a bad signature installs nothing, no verifier = refused (fail
// closed), and only a good asset with a good signature by OUR release workflow installs. AC3: HTTPS-only bases, and the
// default base is the github.com release download.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'install.sh');
const os = { darwin: 'darwin', linux: 'linux' }[process.platform];
const arch = { arm64: 'arm64', x64: 'x64' }[process.arch];
const ASSET = `revition-${os}-${arch}`;
const BINARY = Buffer.from('#!/bin/sh\necho revition-standalone\n');

function bucket(files) {
  const server = http.createServer((req, res) => {
    const name = (req.url ?? '/').slice(1);
    if (files[name] === undefined) return res.writeHead(404).end();
    res.writeHead(200).end(files[name]);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

/** A fake tool that records its arguments and exits with `code`. */
function fake(dir, name, code) {
  const p = join(dir, name);
  writeFileSync(p, `#!/bin/sh\necho "$@" >> "${join(dir, `${name}.args`)}"\nexit ${code}\n`);
  chmodSync(p, 0o755);
}

async function install({ tamper = false, cosign = null, gh = null, base = null }) {
  const sums = `${createHash('sha256').update(BINARY).digest('hex')}  ${ASSET}\n`;
  const b = await bucket({ [ASSET]: tamper ? Buffer.concat([BINARY, Buffer.from('#')]) : BINARY, SHA256SUMS: sums, 'SHA256SUMS.sigstore.json': '{"mediaType":"x"}' });
  const root = mkdtempSync(join(tmpdir(), 'install-sh-'));
  const tools = join(root, 'tools');
  mkdirSync(tools);
  if (cosign !== null) fake(tools, 'cosign', cosign);
  if (gh !== null) fake(tools, 'gh', gh);
  const prefix = join(root, 'bin');
  // Async spawn: the loopback bucket lives in THIS process, so a blocking spawnSync would starve it and curl would hang.
  const r = await new Promise((resolve) => {
    const child = spawn('sh', [SCRIPT], {
      env: { PATH: `${tools}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: root, REVITION_INSTALL_DIR: prefix, REVITION_INSTALL_BASE: base ?? b.base },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
  b.close();
  const args = (n) => (existsSync(join(tools, `${n}.args`)) ? readFileSync(join(tools, `${n}.args`), 'utf8') : '');
  return { code: r.status, err: r.stderr, out: r.stdout, installed: existsSync(join(prefix, 'revition')), prefix, args };
}

describe('T4.1.5 the verified install script', { skip: os === undefined || arch === undefined ? 'unsupported test host' : false }, () => {
  it('[CLI-T4.1.5-AC1] a tampered asset fails verification and installs nothing (the signature tool is never consulted)', async () => {
    const r = await install({ tamper: true, cosign: 0 });
    assert.equal(r.code, 1);
    assert.match(r.err, /sha256 mismatch for revition-/u);
    assert.match(r.err, /nothing installed/u);
    assert.equal(r.installed, false);
    assert.equal(r.args('cosign'), '', 'refused before any signature step');
  });

  it('[CLI-T4.1.5-AC1] a SHA256SUMS whose Sigstore signature does not verify installs nothing', async () => {
    const r = await install({ cosign: 1 });
    assert.equal(r.code, 1);
    assert.match(r.err, /Sigstore signature of SHA256SUMS does not verify/u);
    assert.equal(r.installed, false);
  });

  it('[CLI-T4.1.5-AC1] with no cosign and no gh it refuses (fail closed): never installs unverified', async () => {
    const r = await install({});
    assert.equal(r.code, 1);
    assert.match(r.err, /cannot verify the signature/u);
    assert.equal(r.installed, false);
  });

  it('[CLI-T4.1.5-AC1] a good asset + a good signature by OUR release workflow installs to the user prefix (no sudo)', async () => {
    const r = await install({ cosign: 0 });
    assert.equal(r.code, 0, r.err);
    assert.equal(r.installed, true);
    assert.equal(readFileSync(join(r.prefix, 'revition')).equals(BINARY), true);
    const a = r.args('cosign');
    assert.match(a, /verify-blob --bundle \S+SHA256SUMS\.sigstore\.json/u);
    assert.match(a, /--certificate-identity-regexp \^https:\/\/github\.com\/Revition\/revition-cli\/\\\.github\/workflows\/release\\\.yml@refs\//u);
    assert.match(a, /--certificate-oidc-issuer https:\/\/token\.actions\.githubusercontent\.com/u);
  });

  it('[CLI-T4.1.5-AC1] edge (CLI:3066): without cosign, the GitHub attestation API (gh) verifies the signer workflow', async () => {
    const ok = await install({ gh: 0 });
    assert.equal(ok.code, 0, ok.err);
    assert.match(ok.args('gh'), /attestation verify \S+SHA256SUMS --repo Revition\/revition-cli --signer-workflow Revition\/revition-cli\/\.github\/workflows\/release\.yml/u);
    const bad = await install({ gh: 1 });
    assert.equal(bad.code, 1);
    assert.equal(bad.installed, false);
  });

  it('[CLI-T4.1.5-AC3] a non-HTTPS base is refused; the default base is the github.com release download', async () => {
    const r = await install({ cosign: 0, base: 'http://evil.example' });
    assert.equal(r.code, 1);
    assert.match(r.err, /refusing a non-HTTPS download base/u);
    const text = readFileSync(SCRIPT, 'utf8');
    assert.match(text, /base="https:\/\/github\.com\/\$\{REPO\}\/releases\/latest\/download"/u);
    const code = text.split('\n').filter((l) => !/^\s*#/u.test(l)).join('\n');
    assert.doesNotMatch(code, /\|\s*(sh|bash)\b/u, 'nothing downloaded is piped to a shell (CLI:3058 invariant)');
    assert.match(code, /sha256 mismatch[^\n]*\n[\s\S]*cosign verify-blob[\s\S]*cp "\$tmp\/\$asset"/u, 'verify before install');
  });

  it('[CLI-T4.1.5-AC1] install.ps1 (Windows) checks sha256, then the signature by OUR workflow, then copies; never executes a download', () => {
    const ps = readFileSync(join(dirname(SCRIPT), 'install.ps1'), 'utf8');
    const code = ps.split('\n').filter((l) => !/^\s*#/u.test(l)).join('\n');
    const at = (re) => code.search(re);
    assert.ok(at(/Get-FileHash -Algorithm SHA256/u) > 0);
    assert.ok(at(/sha256 mismatch/u) < at(/cosign verify-blob/u), 'sha256 before the signature');
    assert.ok(at(/cosign verify-blob/u) < at(/gh attestation verify/u));
    assert.ok(at(/cannot verify the signature/u) < at(/Copy-Item/u), 'fail closed before any copy');
    assert.match(code, /--certificate-identity-regexp \$WorkflowIdentity --certificate-oidc-issuer \$OidcIssuer/u);
    assert.match(code, /\$WorkflowIdentity = "\^https:\/\/github\.com\/\$Repo\/\\\.github\/workflows\/release\\\.yml@refs\/"/u);
    assert.doesNotMatch(code, /Invoke-Expression|\biex\b|Start-Process|&\s*\(Join-Path \$Tmp \$Asset\)/u, 'nothing downloaded is executed');
  });

  it('[CLI-T4.1.5-AC3] install.ps1 refuses a non-HTTPS base; its default base is the github.com release download', () => {
    const ps = readFileSync(join(dirname(SCRIPT), 'install.ps1'), 'utf8');
    assert.match(ps, /\$Base = "https:\/\/github\.com\/\$Repo\/releases\/latest\/download"/u);
    assert.match(ps, /if \(-not \(\$Base -match '\^https:\/\/' -or \$Base -match '\^http:\/\/\(127\\\.0\\\.0\\\.1\|localhost\):'\)\) \{ Fail "refusing a non-HTTPS download base/u);
  });
});
