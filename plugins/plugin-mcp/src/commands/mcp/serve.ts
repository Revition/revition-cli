import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { Flags } from '@oclif/core';
import {
  EXIT,
  RevitionCliError,
  RevitionCommand,
  runtime,
  usageError,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

import { PAID_QUOTE_SPECS, QuoteGuard } from '../../quote-guard.js';
import { MCP_PROTOCOL_VERSION, McpServer, serveStdio, type CliRun } from '../../server.js';
import { buildTools, toolArgv, type LoadedCommand } from '../../tool-registry.js';

interface Out {
  readonly tools: number;
}

/** One tool call can run for a while (a test run, logs); past this the call is ended and reported. */
const CALL_TIMEOUT_MS = 15 * 60_000;

/**
 * T3.2.2 - `revition mcp serve`: Revition as an MCP server over stdio for AI clients (Claude Code, Cursor, IDEs), using
 * the profile's own session or PAT. Read-only by default; `--allow-write` adds the mutating tools except typed-confirm
 * ones; paid tools need `revition_quote` first. Stdout carries only the protocol; messages go to stderr.
 */
export default class McpServe extends RevitionCommand<Out> {
  static override summary = 'Run an MCP server over stdio: the platform operations as tools for AI clients.';
  static override examples = [
    'revition mcp serve',
    'revition mcp serve --profile work --tools "revition_apps_*,revition_logs"',
    'revition mcp serve --allow-write',
  ];
  static meta: CommandMeta = {
    id: 'mcp:serve',
    summary: McpServe.summary,
    examples: McpServe.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: null,
    stability: 'beta',
  };
  static override flags = {
    'allow-write': Flags.boolean({ description: 'Also expose tools that change data (never typed-confirm ones).' }),
    tools: Flags.string({ description: 'Only these tools: comma-separated globs over tool names or command ids.' }),
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    if (ctx.flags.json) {
      throw usageError('JSON_NOT_SUPPORTED', 'mcp serve speaks the MCP protocol on stdout; --json does not apply.', 'Run `revition mcp serve` from your MCP client config (docs/mcp.md).');
    }
    const rt = await runtime(ctx);
    if (rt.session.mode === 'none') {
      throw new RevitionCliError({ code: 'AUTH_REQUIRED', message: 'You are not signed in.', hint: 'Run `revition login` (or set REVITION_TOKEN) first.' }, EXIT.auth);
    }
    const api = rt.session.client;
    const allowWrite = ctx.commandFlags['allow-write'] === true;
    const filter = typeof ctx.commandFlags['tools'] === 'string' ? ctx.commandFlags['tools'] : undefined;
    const tools = buildTools(this.config.commands as unknown as LoadedCommand[], { allowWrite, tools: filter, quotable: new Set(Object.keys(PAID_QUOTE_SPECS)) });
    const bin = join(this.config.root, 'bin', 'run');
    const profile = ctx.flags.profile;
    const runCli = (argv: readonly string[], opts: { readonly confirm: boolean }): Promise<CliRun> =>
      runChild(bin, [...argv, '--json', '--no-input', ...(profile === undefined ? [] : [`--profile=${profile}`]), ...(opts.confirm ? ['--yes'] : [])], ctx.env);
    const quotes = new QuoteGuard({
      get: async (path) => (await api.request({ method: 'GET', path })).body,
      dryRun: async (commandId, input) => {
        const tool = tools.find((t) => t.commandId === commandId);
        if (tool === undefined) throw new Error(`${commandId} is not served.`);
        const run = await runCli([...toolArgv(tool, { ...input, quoteId: 'quote' }), '--dry-run'], { confirm: false });
        const env = run.envelope as { ok?: boolean; data?: unknown; error?: { message?: string } } | null;
        if (env?.ok !== true) throw new Error(env?.error?.message ?? `The quote failed (exit ${run.code}).`);
        return env.data;
      },
    });
    const server = new McpServer({ tools, runCli, quotes, serverVersion: ctx.cliVersion });
    ctx.io.err(`revition MCP server (protocol ${MCP_PROTOCOL_VERSION}):${tools.length} tools, ${allowWrite ? 'read and write' : 'read-only'}, profile ${ctx.profile}.\n`);
    ctx.io.flush?.();
    await serveStdio(server, process.stdin, process.stdout);
    return { tools: tools.length };
  }

  protected override human(): HumanView {
    return { text: '' };
  }
}

/** The command's `--json` document (its last stdout line), or null when it printed none. */
function lastJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout.trim().split('\n').at(-1) ?? '') as unknown;
  } catch {
    return null;
  }
}

/** Runs the CLI for one tool call; stdin is closed so nothing can prompt. */
function runChild(bin: string, argv: readonly string[], env: Readonly<Record<string, string | undefined>>): Promise<CliRun> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...argv], {
      stdio: ['ignore', 'pipe', 'pipe'],
      // REVITION_CLIENT: every platform call of a tool says `Revition-Client: mcp` (the audit shows client=mcp, AC5).
      env: { ...env, REVITION_NO_UPDATE_CHECK: '1', REVITION_CLIENT: 'mcp' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString('utf8');
    });
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
    });
    const timer = setTimeout(() => child.kill('SIGINT'), CALL_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? EXIT.general, envelope: lastJson(stdout), stderr });
    });
  });
}
