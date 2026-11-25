import { spawn } from 'node:child_process';

import { Flags } from '@oclif/core';
import {
  channelOf,
  detectInstaller,
  RevitionCliError,
  RevitionCommand,
  runUpgrade,
  upgradeCommand,
  USER_PREFIX_HINT,
  VERIFY_HINT,
  type Channel,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

interface Out {
  readonly installer: string;
  readonly channel: Channel;
  readonly command: string | null;
  readonly ran: boolean;
  readonly instructions: string | null;
}

export default class Upgrade extends RevitionCommand<Out> {
  static override summary = 'Upgrade the CLI with the package manager that installed it (prints the command first).';
  static override examples = ['revition upgrade', 'revition upgrade --channel next'];
  static meta: CommandMeta = {
    id: 'upgrade',
    summary: Upgrade.summary,
    examples: Upgrade.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.upgrade.v1',
    stability: 'stable',
  };
  static override flags = {
    channel: Flags.option({ options: ['latest', 'next', 'canary'] as const, description: 'The release channel (default: the installed one).' })(),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const channel = (ctx.commandFlags['channel'] as Channel | undefined) ?? channelOf(ctx.cliVersion);
    const installer = detectInstaller(this.config.root);
    const cmd = upgradeCommand(installer, channel);
    if (cmd === null) {
      return {
        installer,
        channel,
        command: null,
        ran: false,
        instructions: `The installer of this CLI could not be detected. Upgrade it the way you installed it, e.g. npm install --global @revition/cli@${channel}.`,
      };
    }
    const [bin, args] = cmd;
    const line = `${bin} ${args.join(' ')}`;
    ctx.io.err(`Running: ${line}\n`);
    ctx.io.flush();
    const code = await runUpgrade(cmd, spawn);
    if (code !== 0) {
      throw new RevitionCliError({ code: 'UPGRADE_FAILED', message: `${line} exited ${code}.`, hint: USER_PREFIX_HINT });
    }
    return { installer, channel, command: line, ran: true, instructions: VERIFY_HINT };
  }

  protected override human(d: Out): HumanView {
    return { text: `${d.ran ? `Upgraded with: ${d.command}\n` : ''}${d.instructions ?? ''}\n` };
  }
}
