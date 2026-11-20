import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { Config } from '@oclif/core';
import { metaProblems, RevitionCommand, type CommandMeta } from '@revition/cli-core';

const CLI_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Every command of the built CLI, loaded the way oclif loads it (its manifest of commands). */
async function loadedCommands(): Promise<Array<{ id: string; cls: typeof RevitionCommand & { meta?: CommandMeta } }>> {
  const config = await Config.load(CLI_ROOT);
  return Promise.all(
    config.commands.map(async (c) => ({ id: c.id, cls: (await c.load()) as unknown as typeof RevitionCommand & { meta?: CommandMeta } }))
  );
}

describe('T1.1.1 the command module contract over the manifest', () => {
  it('[CLI-T1.1.1-AC1] every command extends RevitionCommand and has complete meta matching its id', async () => {
    const commands = await loadedCommands();
    assert.ok(commands.length >= 6, `expected the bundled commands, got ${commands.length}`);
    for (const { id, cls } of commands) {
      assert.ok(cls.prototype instanceof RevitionCommand, `${id} does not extend RevitionCommand`);
      assert.deepEqual(metaProblems(cls.meta), [], `${id}: incomplete meta`);
      assert.equal(cls.meta?.id, id, `${id}: meta.id differs from the command id`);
    }
  });

  it('[CLI-T1.1.1-AC1] an incomplete meta is reported field by field', () => {
    assert.deepEqual(metaProblems(undefined), ['meta is missing']);
    const problems = metaProblems({ id: 'Apps List', summary: '', examples: [], requiredScopes: ['cli:root'] });
    for (const p of ['id must be', 'summary is empty', 'examples', 'unknown scope', 'mutates', 'confirm', 'stability']) {
      assert.ok(problems.some((x) => x.includes(p)), `missing problem "${p}" in ${JSON.stringify(problems)}`);
    }
    assert.ok(
      metaProblems({
        id: 'apps:delete',
        summary: 's',
        examples: ['e'],
        requiredScopes: [],
        mutates: true,
        confirm: 'none',
        jsonSchemaId: null,
        stability: 'stable',
      }).some((p) => p.includes('mutating command needs confirm')),
      'mutates with confirm none must be refused'
    );
  });
});
