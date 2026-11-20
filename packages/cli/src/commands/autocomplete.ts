import { Args } from '@oclif/core';
import {
  RevitionCommand,
  usageError,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

import { completionScript, SHELLS, type Shell } from '../completion.js';

interface Out {
  readonly shell: Shell;
  readonly script: string;
}

export default class Autocomplete extends RevitionCommand<Out> {
  static override summary = 'Print the completion script for bash, zsh, fish or PowerShell.';
  static override examples = ['revition autocomplete zsh', 'revition autocomplete bash > ~/.revition-completion.bash'];
  static meta: CommandMeta = {
    id: 'autocomplete',
    summary: Autocomplete.summary,
    examples: Autocomplete.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.autocomplete.v1',
    stability: 'stable',
  };
  static override args = {
    shell: Args.string({ options: [...SHELLS], description: 'The shell (default: from $SHELL).' }),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const fromEnv = (ctx.env['SHELL'] ?? '').split(/[\\/]/).pop() ?? '';
    const shell = (ctx.args['shell'] ?? (SHELLS as readonly string[]).find((s) => s === fromEnv)) as Shell | undefined;
    if (shell === undefined) {
      throw usageError('SHELL_REQUIRED', 'Name the shell: bash, zsh, fish or powershell.', 'revition autocomplete zsh');
    }
    const commands = this.config.commands
      .filter((c) => c.hidden !== true)
      .map((c) => ({
        words: c.id.replace(/:/g, ' '),
        summary: c.summary ?? '',
        flags: Object.entries(c.flags ?? {})
          .filter(([, f]) => f.hidden !== true)
          .map(([name]) => name),
      }));
    return { shell, script: completionScript(shell, this.config.bin, commands) };
  }

  protected override human(data: Out): HumanView {
    return { text: data.script };
  }
}
