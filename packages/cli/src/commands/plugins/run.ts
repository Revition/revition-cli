import { Args } from '@oclif/core';
import { EXIT, RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';
import { runInstalledPlugin } from '@revition/cli-core/plugins';

import { pluginsRuntime } from '../../plugins-runtime.js';

interface Out {
  readonly plugin: string;
  readonly command: string;
  readonly exitCode: number;
}

/**
 * T4.2.2 / T4.2.3 - run an installed plugin's command in the sandbox. Each run re-checks the registry listing, your
 * workspace's allowlist and the publisher (a revoked publisher's plugin is disabled with a message).
 */
export default class PluginsRun extends RevitionCommand<Out> {
  static override summary = "Run an installed plugin's command (sandboxed, with only its declared permissions).";
  static override examples = ['revition plugins run @acme/revition-plugin-tickets list --project WEB'];
  static override strict = false;
  static meta: CommandMeta = {
    id: 'plugins:run',
    summary: PluginsRun.summary,
    examples: PluginsRun.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.plugins.run.v1',
    stability: 'stable',
  };
  static override args = {
    plugin: Args.string({ required: true, description: 'The installed plugin.' }),
    command: Args.string({ required: true, description: "The plugin's command." }),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const plugin = String(ctx.args['plugin']);
    const command = String(ctx.args['command']);
    const rest = this.argv.slice(this.argv.indexOf(command) + 1).filter((a) => !['--json', '--yes', '--no-input'].includes(a));
    const p = await pluginsRuntime(ctx);
    const exitCode = await runInstalledPlugin(plugin, command, rest, {
      index: p.platform,
      publishers: p.platform,
      configDir: p.configDir,
      projectRoot: process.cwd(),
      api: p.api,
      env: ctx.env,
    });
    // A permission refusal inside the plugin keeps its meaning (4); any other failure is a general one.
    if (exitCode !== 0) ctx.setExitCode?.(exitCode === EXIT.permission ? EXIT.permission : EXIT.general);
    return { plugin, command, exitCode };
  }

  protected override human(_d: Out): HumanView | null {
    return null;
  }
}
