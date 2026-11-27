// T1.6.3 (REVITION-CLI-PLAN.md:1904-1924) and T2.5.3 (:2523-2539): the docs and the stable release, the local half.
// - T1.6.3 AC1 "the docs are live": every topic the plan lists for developer.revition.com/cli is in docs/README.md,
//   and every relative link in docs/ resolves (the link checker the live check runs, here on the source).
// - T2.5.3 AC1 "1.0.0 with provenance": the stable path publishes to `latest` only through OIDC trusted publishing
//   (provenance attached by npm), never with a token, and verifies the channel after the publish.
// - T2.5.3 AC2 "the quickstart works": every command docs/quickstart.md tells a new user to run is a real command
//   of this CLI with flags it has (checked against the reference generated from the CLI itself).
// The live site, the 3-OS installs from `next` / `latest` and the fresh-user walkthrough stay the live part (L4).
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

function mdFiles(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? mdFiles(p) : n.endsWith('.md') ? [p] : [];
  });
}

/** GitHub-style heading anchors of a markdown file. */
function anchors(md) {
  return new Set(
    [...md.matchAll(/^#{1,6} (.+)$/gmu)].map((m) =>
      m[1].trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /gu, '-')
    )
  );
}

/** Broken relative links ([text](target) not http(s)/mailto) in the given markdown files. */
export function brokenLinks(files) {
  const out = [];
  for (const f of files) {
    const md = readFileSync(f, 'utf8').replace(/```[\s\S]*?```/gu, '');
    for (const m of md.matchAll(/\]\(([^)\s]+)\)/gu)) {
      const target = m[1];
      if (/^(https?:|mailto:)/u.test(target)) continue;
      const [path, anchor] = target.split('#');
      const file = path === '' ? f : resolve(dirname(f), path);
      if (!existsSync(file)) out.push(`${f.slice(ROOT.length + 1)} -> ${target} (no such file)`);
      else if (anchor !== undefined && anchor !== '' && file.endsWith('.md') && !anchors(readFileSync(file, 'utf8')).has(anchor)) {
        out.push(`${f.slice(ROOT.length + 1)} -> ${target} (no such heading)`);
      }
    }
  }
  return out;
}

describe('T1.6.3 / T2.5.3 docs and the stable release', () => {
  it('[CLI-T1.6.3-AC1] the docs home covers every topic the plan lists for developer.revition.com/cli', () => {
    const home = read('docs', 'README.md');
    const must = [
      [/npm install -g @revition\/cli/u, 'install (npm)'],
      [/npm audit signatures/u, 'verify provenance'],
      [/revition login +#/u, 'browser login'],
      [/revition login --device/u, 'device login'],
      [/\[CI\]\(ci\.md\)/u, 'CI login'],
      [/## Profiles/u, 'profiles'],
      [/\[Configuration\]\(config\.md\)/u, 'config'],
      [/exit codes/u, 'output / exit codes'],
      [/\[Telemetry\]\(telemetry\.md\)/u, 'telemetry'],
      [/revition doctor/u, 'troubleshooting (doctor)'],
      [/\[Credentials\]\(security\/credentials\.md\)/u, 'security (storage, sessions, revoke)'],
      [/## Changelog/u, 'changelog'],
      [/revition logout --all/u, 'uninstall: logout --all'],
      [/npm uninstall -g @revition\/cli/u, 'uninstall: npm uninstall'],
      [/revition config path/u, 'uninstall: the directories from config path'],
      [/\[command reference\]\(reference\/commands\.md\)/u, 'the generated command reference'],
    ];
    assert.deepEqual(must.filter(([re]) => !re.test(home)).map(([, what]) => what), []);
  });

  it('[CLI-T1.6.3-AC1] link check: every relative link in docs/ (and the README) resolves to a file and heading', () => {
    const files = [...mdFiles(DOCS), join(ROOT, 'README.md')];
    assert.ok(files.length > 30);
    assert.deepEqual(brokenLinks(files), []);
  });

  it('[CLI-T2.5.3-AC1] the stable release publishes to latest only through OIDC trusted publishing (provenance), then verifies it', () => {
    const wf = read('.github', 'workflows', 'release.yml');
    const start = wf.indexOf('\n  publish-stable:\n');
    assert.ok(start > 0, 'the publish-stable job exists');
    const next = wf.slice(start + 1).search(/\n {2}[\w-]+:\n/u);
    const job = next < 0 ? wf.slice(start) : wf.slice(start, start + 1 + next);
    assert.match(job, /environment: npm-release/u);
    assert.match(job, /id-token: write/u);
    assert.match(job, /npm publish "\.\/release-artifacts\/\$f" --tag "\$CHANNEL" --access public/u);
    assert.match(job, /node scripts\/verify-release\.mjs @revition\/cli "\$CHANNEL"/u);
    assert.doesNotMatch(wf, /NPM_TOKEN|NODE_AUTH_TOKEN|_authToken/u, 'no npm token anywhere: provenance comes from the OIDC publish');
    assert.match(wf, /options: \[canary, next, latest\]/u);
    const verify = read('scripts', 'verify-release.mjs');
    assert.match(verify, /audit', 'signatures'|audit signatures/u);
  });

  it('[CLI-T2.5.3-AC2] every quickstart command is a real command with flags it has (the generated reference)', () => {
    const ref = read('docs', 'reference', 'commands.md');
    const sections = new Map(
      [...ref.matchAll(/^## `revition ([^`]+)`\n([\s\S]*?)(?=^## )/gmu)].map((m) => [m[1], m[2]])
    );
    const globals = ref.slice(ref.indexOf('## Global flags'));
    const quick = read('docs', 'quickstart.md');
    const lines = [...quick.matchAll(/```sh\n([\s\S]*?)```/gu)]
      .flatMap((m) => m[1].split('\n'))
      .map((l) => l.replace(/\s+#.*$/u, '').trim())
      .filter((l) => l.startsWith('revition '));
    assert.ok(lines.length >= 10, `quickstart commands found: ${lines.length}`);
    const problems = [];
    for (const line of lines) {
      const words = line.split(/\s+/u).slice(1);
      let cmd = null;
      for (let n = words.length; n > 0 && cmd === null; n -= 1) {
        const c = words.slice(0, n).join(' ');
        if (sections.has(c)) cmd = c;
      }
      if (cmd === null) {
        problems.push(`${line}: no such command`);
        continue;
      }
      for (const flag of words.filter((w) => w.startsWith('--'))) {
        const name = flag.split('=')[0];
        // A flag is listed as `--name ...` or `-n, --name ...` in its command's section or under Global flags.
        const listed = new RegExp(`^- \`(?:-\\w, )?${name}(?![\\w-])`, 'mu');
        if (!listed.test(sections.get(cmd)) && !listed.test(globals)) problems.push(`${line}: ${name} is not a flag of ${cmd}`);
      }
    }
    assert.deepEqual(problems, []);
  });
});
