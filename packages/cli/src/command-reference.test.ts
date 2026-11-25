import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { cliDirs } from './test-fixtures/cli-dirs.js';
import { CLI_BIN, runCli } from './test-fixtures/spawn-cli.js';

const SCRIPT = fileURLToPath(new URL('../scripts/command-reference.mjs', import.meta.url));
const REFERENCE = fileURLToPath(new URL('../../../docs/reference/commands.md', import.meta.url));

/** `## \`revition a b\`` sections of the reference: command words -> section text. */
function sections(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = text.split(/^## `revition ([^`]+)`$/m);
  for (let i = 1; i < parts.length; i += 2) out.set(parts[i] ?? '', parts[i + 1] ?? '');
  return out;
}

const flagNames = (text: string): string[] => [...new Set([...text.matchAll(/--([a-z][a-z0-9-]*)/g)].map((m) => m[1] ?? ''))].sort();

describe('T1.6.3 command reference', () => {
  it('[CLI-T1.6.3-AC3] the committed reference equals what the build generates (drift check)', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });

  it('[CLI-T1.6.3-AC3] every command in the reference matches `revition <command> --help` (summary and flags)', async () => {
    const env = { ...cliDirs(await mkdtemp(join(tmpdir(), 'revref-'))) };
    const ref = sections(await readFile(REFERENCE, 'utf8'));
    assert.ok(ref.size >= 20, `the reference lists the commands (${ref.size})`);
    for (const [words, section] of ref) {
      if (words === '') continue;
      const help = await runCli(CLI_BIN, [...words.split(' '), '--help'], { env });
      assert.equal(help.code, 0, `${words} --help: ${help.stderr}`);
      const summary = section.trim().split('\n')[0] ?? '';
      assert.ok(help.stdout.includes(summary), `${words}: the help shows the reference summary "${summary}"`);
      const own = flagNames(section.split(/^Examples:$/m)[0] ?? '');
      const shown = flagNames(help.stdout.split(/^GLOBAL FLAGS$/m)[0] ?? '');
      for (const f of own) assert.ok(shown.includes(f), `${words}: --${f} is in the reference but not in --help`);
    }
  });
});
