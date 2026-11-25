import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { ESLint } from 'eslint';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: REPO });
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'parse-error');
}

describe('the repo lint rules', () => {
  it('[CLI-T1.1.4-AC4] the lint rule fails on a new console.log in any package source', async () => {
    assert.ok((await ruleIds('console.log("x");\n', 'packages/core/src/new-file.ts')).includes('no-console'));
    assert.ok((await ruleIds('console.error("x");\n', 'packages/cli/src/commands/x.ts')).includes('no-console'));
    assert.deepEqual(await ruleIds('export const x = 1;\n', 'packages/core/src/new-file.ts'), []);
  });

  it('[CLI-T1.1.1-AC1] the lint rule fails on a command that does not extend RevitionCommand', async () => {
    const bad = "import { Command } from '@oclif/core';\nexport default class X extends Command { async run(): Promise<void> {} }\n";
    assert.ok((await ruleIds(bad, 'packages/cli/src/commands/x.ts')).includes('no-restricted-syntax'));
    const good =
      "import { RevitionCommand } from '@revition/cli-core';\nexport default abstract class X extends RevitionCommand<null> {}\n";
    assert.ok(!(await ruleIds(good, 'packages/cli/src/commands/x.ts')).includes('no-restricted-syntax'));
  });
});
