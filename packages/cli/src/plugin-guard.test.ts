import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { PLUGIN_POLICY_URL } from '@revition/cli-core/plugins';

import { duplicateCommandRefusals } from './plugin-guard.js';
import { CLI_BIN } from './test-fixtures/spawn-cli.js';

/**
 * T1.1.1 AC4 (REVITION-CLI-PLAN.md:765) under the Phase 4 policy (T4.2.1-T4.2.3): `plugins install some-third-party` is
 * refused with a message citing the policy - now because the Revition registry does not list it (only verified plugins
 * from registered publishers install). The real CLI, against a local platform that lists nothing; the refusal comes
 * before anything is fetched from npm (the npm registry is never contacted: the platform answers first).
 */
async function emptyRegistry(): Promise<{ host: string; paths: string[]; close: () => void }> {
  const paths: string[] = [];
  const server = http.createServer((req, res) => {
    paths.push(`${req.method} ${req.url}`);
    const body = (req.url ?? '').startsWith('/api/v1/foundry/dev/plugins') ? { plugins: [] } : { error: { code: 'AGENT_NOT_FOUND', message: 'x' } };
    res.writeHead(body === null ? 404 : 200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    host: `127.0.0.1:${(server.address() as AddressInfo).port}`,
    paths,
    close: () => {
      server.close();
      server.closeAllConnections();
    },
  };
}

function cli(args: string[], host: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return (async () => {
    const root = await mkdtemp(join(tmpdir(), 'guard-'));
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [CLI_BIN, ...args], {
        env: {
          ...process.env,
          NO_COLOR: '1',
          REVITION_NO_UPDATE_CHECK: '1',
          REVITION_HOST: host,
          REVITION_TOKEN: `rvt_${'G'.repeat(40)}`,
          XDG_CONFIG_HOME: join(root, 'c'),
          XDG_STATE_HOME: join(root, 's'),
          XDG_CACHE_HOME: join(root, 'k'),
          HTTPS_PROXY: 'http://127.0.0.1:9',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
      child.stdin.end('');
    });
  })();
}

describe('T1.1.1 the plugin policy (Phase 4: verified + listed + allowed)', () => {
  it('[CLI-T1.1.1-AC4] the real CLI refuses `plugins install some-third-party` (exit 4, the policy in stderr, nothing in stdout)', async () => {
    const p = await emptyRegistry();
    try {
      const r = await cli(['plugins', 'install', 'some-third-party', '--yes'], p.host);
      assert.equal(r.code, 4, r.stderr);
      assert.ok(r.stderr.includes(PLUGIN_POLICY_URL), r.stderr);
      assert.match(r.stderr, /some-third-party is not in the Revition plugin registry/u);
      assert.equal(r.stdout, '');
      // The registry lookup was the only call; npm is behind an unreachable proxy here, so any fetch would have failed
      // with a network error (exit 9), not the policy refusal.
      assert.deepEqual(p.paths, ['GET /api/v1/foundry/dev/plugins?name=some-third-party']);
    } finally {
      p.close();
    }
  });

  it('[CLI-T1.1.1-AC4] a look-alike of a first-party name is refused the same way', async () => {
    const p = await emptyRegistry();
    try {
      const r = await cli(['plugins', 'install', '@revitionx/look-alike', '--yes'], p.host);
      assert.equal(r.code, 4, r.stderr);
      assert.ok(r.stderr.includes(PLUGIN_POLICY_URL));
    } finally {
      p.close();
    }
  });

  it('[CLI-T1.1.1-AC4] a plugin that redefines a core command is refused; the core keeps it', () => {
    const refusals = duplicateCommandRefusals(
      [
        { id: 'config:get', pluginName: '@revition/cli' },
        { id: 'config:get', pluginName: 'evil-plugin' },
        { id: 'extra:thing', pluginName: 'evil-plugin' },
      ],
      '@revition/cli'
    );
    assert.deepEqual(refusals, ['Refused plugin evil-plugin: it redefines the core command "config get".']);
  });
});
