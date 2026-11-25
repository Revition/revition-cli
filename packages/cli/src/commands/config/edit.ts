import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';

import {
  atomicWriteFile,
  defaultCliPaths,
  defaultUserConfig,
  loadUserConfig,
  RevitionCommand,
  usageError,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

interface Out {
  readonly file: string;
}

export default class ConfigEdit extends RevitionCommand<Out> {
  static override summary = 'Open the config file in $VISUAL / $EDITOR, then validate it.';
  static override examples = ['revition config edit'];
  static meta: CommandMeta = {
    id: 'config:edit',
    summary: ConfigEdit.summary,
    examples: ConfigEdit.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: null,
    stability: 'stable',
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    if (ctx.flags.json || ctx.flags.noInput || !ctx.io.stdinIsTTY) {
      throw usageError('CONFIG_EDIT_NEEDS_TERMINAL', 'config edit opens an editor and needs a terminal.', 'Use `revition config set`.');
    }
    const { configFile } = defaultCliPaths();
    const exists = await access(configFile).then(() => true, () => false);
    if (!exists) await atomicWriteFile(configFile, `${JSON.stringify(defaultUserConfig(), null, 2)}\n`);
    const editor = ctx.env['VISUAL'] ?? ctx.env['EDITOR'] ?? (process.platform === 'win32' ? 'notepad' : 'vi');
    ctx.io.flush();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(editor, [configFile], { stdio: 'inherit', shell: true });
      child.on('error', reject);
      child.on('close', () => resolve());
    });
    // Validate what the user saved (a corrupt file is backed up and reported by the loader).
    await loadUserConfig(configFile);
    return { file: configFile };
  }

  protected override human(data: Out): HumanView {
    return { text: `${data.file} is valid\n` };
  }
}
