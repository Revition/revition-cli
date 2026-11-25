import { RevitionCommand, renderTable, terminalTable, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

/**
 * T3.2.1 - `revition commands`: every command this CLI has (core and every installed plugin), with its declared meta
 * (scopes, whether it changes anything, its confirmation, its `--json` schema id, its stability, paid / deprecated):
 * the machine contract an AI agent or a script reads before driving the CLI.
 */
export interface CommandInfo {
  readonly id: string;
  readonly summary: string;
  readonly requiredScopes: readonly string[];
  readonly mutates: boolean;
  readonly confirm: string;
  readonly jsonSchemaId: string | null;
  readonly stability: string;
  readonly paid: boolean;
  readonly deprecated: boolean;
  readonly plugin: string;
}

interface Out {
  readonly commands: readonly CommandInfo[];
}

/** The listing from the loaded commands' meta (oclif's cached manifests carry it). PURE. */
export function commandInfos(loaded: readonly { readonly id: string; readonly pluginName?: string; readonly meta?: unknown }[]): CommandInfo[] {
  return loaded
    .filter((c): c is { id: string; pluginName?: string; meta: CommandMeta } => c.meta !== undefined && c.meta !== null)
    .map((c) => ({
      id: c.meta.id,
      summary: c.meta.summary,
      requiredScopes: [...c.meta.requiredScopes],
      mutates: c.meta.mutates,
      confirm: c.meta.confirm,
      jsonSchemaId: c.meta.jsonSchemaId,
      stability: c.meta.stability,
      paid: c.meta.paid !== undefined,
      deprecated: c.meta.deprecated !== undefined,
      plugin: c.pluginName ?? '@revition/cli',
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export default class Commands extends RevitionCommand<Out> {
  static override summary = 'Every command with its machine contract (scopes, changes, confirmation, JSON schema).';
  static override examples = ['revition commands', 'revition commands --json'];
  static meta: CommandMeta = {
    id: 'commands',
    summary: Commands.summary,
    examples: Commands.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.commands.v1',
    stability: 'stable',
  };

  protected async run2(_ctx: CommandContext): Promise<Out> {
    return { commands: commandInfos(this.config.commands as unknown as { id: string; pluginName?: string; meta?: unknown }[]) };
  }

  protected override human(o: Out): HumanView {
    return {
      text: renderTable(
        ['command', 'scopes', 'changes', 'confirm', 'schema', 'stability'],
        o.commands.map((c) => [
          c.id.replace(/:/g, ' '),
          c.requiredScopes.join(',') || '-',
          c.mutates ? 'yes' : 'no',
          c.paid ? `${c.confirm} (paid)` : c.confirm,
          c.jsonSchemaId ?? '-',
          c.deprecated ? `${c.stability} (deprecated)` : c.stability,
        ]),
        terminalTable()
      ),
    };
  }
}
