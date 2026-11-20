import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { Config } from '@oclif/core';
import { isEnvelope } from '@revition/cli-core';

import { CLI_BIN, runCli } from './test-fixtures/spawn-cli.js';

const CLI_ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('T1.1.3 the --json envelope over every command', () => {
  it('[CLI-T1.1.3-AC1] every manifest command emits exactly one valid envelope on stdout under --json', async () => {
    const config = await Config.load(CLI_ROOT);
    const home = await mkdtemp(join(tmpdir(), 'revenv-'));
    const env = { XDG_CONFIG_HOME: join(home, 'c'), XDG_STATE_HOME: join(home, 's'), XDG_CACHE_HOME: join(home, 'k'), HOME: home };
    assert.ok(config.commands.length > 0);
    for (const cmd of config.commands) {
      // One placeholder per required argument; a refusal is still an envelope.
      const args = Object.values(cmd.args ?? {}).filter((a) => a.required === true).map(() => 'telemetry');
      const r = await runCli(CLI_BIN, [...cmd.id.split(':'), ...args, '--json'], { env });
      const lines = r.stdout.trim().split('\n');
      assert.equal(lines.length, 1, `${cmd.id}: stdout is not one document:\n${r.stdout}\n${r.stderr}`);
      const doc = JSON.parse(lines[0] ?? '') as unknown;
      assert.ok(isEnvelope(doc), `${cmd.id}: not an envelope: ${lines[0]}`);
      assert.equal((doc as { command: string }).command, cmd.id);
      assert.equal(r.code === 0, (doc as { ok: boolean }).ok, `${cmd.id}: exit ${r.code} vs ok`);
    }
  });
});
