// T4.1.1 (REVITION-CLI-PLAN.md:2979-2984) - the matrix smoke for one built standalone binary (the release matrix runs it
// on every target; locally on this machine). Prints one JSON report; exit 1 when any AC fails.
//   node scripts/sea-smoke.mjs [--out dist-sea] [--report <file.json>]
//   AC1 the binary runs `--version` and `doctor`, and doctor reports the keychain binding loaded from the embedded addon
//   AC2 its cold start (median of 7 `--version`, after the one-time unpack) is <= the npm-installed CLI's
//   AC3 its checksum is published (SHA256SUMS has the binary's sha256)
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const OUT = join(ROOT, arg('--out', 'dist-sea'));
const EXE_NAME = `revition-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`;
const EXE = join(OUT, EXE_NAME);
const NPM_BIN = join(ROOT, 'packages', 'cli', 'bin', 'run');
const home = mkdtempSync(join(tmpdir(), 'sea-smoke-'));
const env = { ...process.env, XDG_CACHE_HOME: join(home, 'cache'), XDG_CONFIG_HOME: join(home, 'config'), XDG_STATE_HOME: join(home, 'state'), LOCALAPPDATA: join(home, 'local'), APPDATA: join(home, 'roaming'), REVITION_NO_UPDATE_CHECK: '1', NO_COLOR: '1' };

const timed = (cmd, args) => {
  const t = process.hrtime.bigint();
  const r = spawnSync(cmd, args, { env, encoding: 'utf8' });
  return { ms: Number(process.hrtime.bigint() - t) / 1e6, code: r.status, out: r.stdout, err: r.stderr };
};
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const first = timed(EXE, ['--version']);
const version = JSON.parse(readFileSync(join(ROOT, 'packages', 'cli', 'package.json'), 'utf8')).version;
const doctor = spawnSync(EXE, ['doctor', '--json'], { env, encoding: 'utf8' });
const doc = JSON.parse(doctor.stdout || '{}');
const store = (doc.data?.checks ?? []).find((c) => c.id === 'credential-store') ?? null;
const keychainHost = process.platform === 'darwin' || process.platform === 'win32';
const sea = [];
const npm = [];
for (let i = 0; i < 7; i++) {
  sea.push(timed(EXE, ['--version']).ms);
  npm.push(timed(process.execPath, [NPM_BIN, '--version']).ms);
}
const sums = readFileSync(join(OUT, 'SHA256SUMS'), 'utf8');
const digest = createHash('sha256').update(readFileSync(EXE)).digest('hex');
const report = {
  at: new Date().toISOString(),
  commit: execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
  target: `${process.platform}-${process.arch}`,
  ac1: {
    firstRunMs: Math.round(first.ms),
    versionExit: first.code,
    versionOut: first.out.trim(),
    versionMatches: first.out.startsWith(`@revition/cli/${version} `),
    doctorExit: doctor.status,
    credentialStore: store,
    embeddedAddon: store !== null && (keychainHost ? store.status === 'ok' && /embedded addon/u.test(store.message) : store.status !== 'fail'),
  },
  ac2: { seaMedianMs: Math.round(median(sea)), npmMedianMs: Math.round(median(npm)), seaRunsMs: sea.map(Math.round), npmRunsMs: npm.map(Math.round) },
  ac3: { sha256: digest, published: sums.split('\n').includes(`${digest}  ${EXE_NAME}`) },
};
report.ac2.pass = report.ac2.seaMedianMs <= report.ac2.npmMedianMs;
const ac1 = report.ac1.versionExit === 0 && report.ac1.versionMatches && report.ac1.doctorExit !== null && report.ac1.embeddedAddon;
report.pass = ac1 && report.ac2.pass && report.ac3.published;
// Per-row verdicts for the evidence index (each row judged by its own clause only).
report.rows = { '[CLI-T4.1.1-AC1]': ac1, '[CLI-T4.1.1-AC2]': report.ac2.pass, '[CLI-T4.1.1-AC3]': report.ac3.published };
const text = `${JSON.stringify(report, null, 2)}\n`;
if (process.argv.includes('--report')) writeFileSync(arg('--report', ''), text);
process.stdout.write(text);
process.exit(report.pass ? 0 : 1);
