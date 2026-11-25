import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { Args, Flags } from '@oclif/core';
import { EXIT, RevitionCommand, usageError, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { DEFINITION_SUFFIX, draftBody } from '../../format.js';
import { validateLocal, type Finding } from '../../validate.js';

import { agentsApi, seg } from './list.js';

interface ServerCheck {
  readonly valid: boolean;
  readonly issues: readonly string[];
  readonly diff: { readonly changedSections: readonly string[]; readonly added: readonly string[]; readonly removed: readonly string[]; readonly permissionDelta?: unknown } | null;
}

interface FileResult {
  readonly file: string;
  readonly ok: boolean;
  readonly problems: readonly Finding[];
  readonly warnings: readonly Finding[];
  readonly server: ServerCheck | null;
}

interface Out {
  readonly ok: boolean;
  readonly files: readonly FileResult[];
}

/** The files named, or every `agents/*.agent.yaml` under the current directory. */
function filesOf(argv: readonly string[]): string[] {
  if (argv.length > 0) return [...argv];
  const dir = join(process.cwd(), 'agents');
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(DEFINITION_SUFFIX)).sort().map((n) => join(dir, n)) : [];
}

/**
 * T3.1.1 - `revition agents validate [files...] [--server]`: the platform's schema and the secret scan, locally; with
 * `--server`, the platform's own dry run (POST .../draft/validate: the compile, the references it resolves and the
 * compatibility / permission diff against the live agent). Nothing is saved.
 */
export default class AgentsValidate extends RevitionCommand<Out> {
  static override summary = 'Check agent definition files: the schema and no inline secrets (and, with --server, the platform).';
  static override strict = false;
  static override examples = ['revition agents validate', 'revition agents validate agents/support.agent.yaml --server'];
  static meta: CommandMeta = {
    id: 'agents:validate',
    summary: AgentsValidate.summary,
    examples: AgentsValidate.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.agents.validate.v1',
    stability: 'beta',
  };
  static override args = { files: Args.string({ description: 'Definition files (default: agents/*.agent.yaml).' }) };
  static override flags = { server: Flags.boolean({ description: "Also run the platform's dry-run validation (needs the agent id in the file)." }) };

  protected async run2(ctx: CommandContext): Promise<Out> {
    // The file arguments (any count): the tokens naming YAML / JSON files, so a flag's value is never taken for one.
    const files = filesOf(this.argv.filter((a) => !a.startsWith('-') && /\.(ya?ml|json)$/i.test(a)));
    if (files.length === 0) throw usageError('NO_DEFINITIONS', 'No definition files: none named and no agents/*.agent.yaml here.', 'Pull one with `revition agents pull <id>`.');
    const results: FileResult[] = [];
    for (const file of files) {
      if (!existsSync(file)) throw usageError('FILE_NOT_FOUND', `No such file: ${file}.`);
      const local = validateLocal(readFileSync(file, 'utf8'));
      let server: ServerCheck | null = null;
      if (ctx.commandFlags['server'] === true && local.ok && local.definition !== null) {
        const id = local.definition.agent.id;
        if (id === null) throw usageError('NO_AGENT_ID', `${file} names no agent yet (agent.id is null).`, 'Create it first with `revition agents create`.');
        const api = await agentsApi(ctx);
        server = (await api.request<ServerCheck>({ method: 'POST', path: `/deployments/${seg(id)}/draft/validate`, body: draftBody(local.definition, null) })).body;
      }
      results.push({ file, ok: local.ok && (server === null || server.valid), problems: local.problems, warnings: local.warnings, server });
    }
    const ok = results.every((r) => r.ok);
    if (!ok) ctx.setExitCode?.(EXIT.conflict);
    return { ok, files: results };
  }

  protected override human(o: Out): HumanView {
    const lines = o.files.flatMap((r) => [
      `${r.ok ? 'ok' : 'failed'} ${r.file}`,
      ...r.problems.map((p) => `  ${p.line === null ? p.path : `line ${p.line}`}: ${p.message}`),
      ...r.warnings.map((w) => `  warning ${w.path}: ${w.message}`),
      ...(r.server === null
        ? []
        : [
            ...r.server.issues.map((i) => `  server: ${i}`),
            ...(r.server.diff === null ? [] : [`  vs live: ${r.server.diff.changedSections.join(', ') || 'no change'}`]),
          ]),
    ]);
    return { text: `${lines.join('\n')}\n` };
  }
}
