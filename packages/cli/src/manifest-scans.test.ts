import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { Config } from '@oclif/core';

const CLI_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Every flag of every command (the oclif manifest), base flags included. */
async function allFlags(): Promise<Array<{ command: string; name: string; type: string; char?: string }>> {
  const config = await Config.load(CLI_ROOT);
  return config.commands.flatMap((c) =>
    Object.entries(c.flags ?? {}).map(([name, f]) => ({ command: c.id, name, type: f.type, ...(f.char === undefined ? {} : { char: f.char }) }))
  );
}

describe('manifest scans', () => {
  it('[CLI-T1.3.5-AC2] no command, flag or argument lets the client choose a workspace', async () => {
    const config = await Config.load(CLI_ROOT);
    const selector = /^(org|org-id|organization|workspace|tenant|team)$/i;
    // REVITION-CLI-PLAN T2.1.1 (CLI:1946, 1958): these two set the developer ACCOUNT's identity link, which the platform
    // checks against the org's membership; neither chooses the workspace a request runs in.
    const identityLink = new Set(['account:register --org', 'account:link-workspace --org']);
    for (const f of await allFlags()) {
      if (identityLink.has(`${f.command} --${f.name}`)) continue;
      assert.doesNotMatch(f.name, selector, `${f.command} --${f.name}`);
    }
    for (const c of config.commands) {
      for (const a of Object.keys(c.args ?? {})) assert.doesNotMatch(a, selector, `${c.id} <${a}>`);
      assert.doesNotMatch(c.id, /(^|:)(workspace|org):(use|switch|select)$/, c.id);
    }
  });

  it('[CLI-T1.3.6-AC1] no flag accepts a secret value (token / secret / password / key)', async () => {
    const flags = await allFlags();
    assert.ok(flags.length > 20);
    const secretish = flags.filter((f) => f.type === 'option' && /(token|secret|password|passphrase|key|credential)/i.test(f.name));
    assert.deepEqual(secretish, [], JSON.stringify(secretish));
    // --with-token exists and takes no value: the token comes from stdin only.
    const withToken = flags.find((f) => f.command === 'login' && f.name === 'with-token');
    assert.equal(withToken?.type, 'boolean');
  });
});
