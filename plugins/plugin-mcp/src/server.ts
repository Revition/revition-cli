import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

import { QuoteRefused, type QuoteGuard } from './quote-guard.js';
import { toolArgv, type ToolSpec } from './tool-registry.js';

/**
 * T3.2.2 - the MCP server (stdio transport: one JSON-RPC 2.0 message per line). The MCP protocol revision is pinned:
 * an `initialize` asking for another revision is answered with this one (the client decides whether to continue).
 * Each tool call runs the real CLI command with `--json --no-input` under the user's own session or PAT, so the
 * platform governs every effect (scopes, RBAC, Sentinel) exactly as for the CLI.
 */
export const MCP_PROTOCOL_VERSION = '2025-06-18';

export const QUOTE_TOOL = 'revition_quote';

/** What a tool call ran: the CLI's exit code and its one `--json` envelope (null when it printed none). */
export interface CliRun {
  readonly code: number;
  readonly envelope: unknown;
  readonly stderr: string;
}

export interface ServerDeps {
  readonly tools: readonly ToolSpec[];
  /** Runs `revition <argv...> --json --no-input [--yes]` for a tool call. */
  readonly runCli: (argv: readonly string[], opts: { readonly confirm: boolean }) => Promise<CliRun>;
  readonly quotes: QuoteGuard;
  readonly serverVersion: string;
}

type Id = string | number | null;

interface Rpc {
  readonly jsonrpc?: unknown;
  readonly id?: Id;
  readonly method?: unknown;
  readonly params?: unknown;
}

export const RPC = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603 } as const;

const ok = (id: Id, result: unknown): object => ({ jsonrpc: '2.0', id, result });
const fail = (id: Id, code: number, message: string): object => ({ jsonrpc: '2.0', id, error: { code, message } });

function textResult(payload: unknown, isError: boolean): object {
  const structured = typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? { structuredContent: payload } : {};
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], ...structured, isError };
}

export class McpServer {
  private readonly byName: ReadonlyMap<string, ToolSpec>;
  private readonly paid: readonly ToolSpec[];

  constructor(private readonly deps: ServerDeps) {
    this.byName = new Map(deps.tools.map((t) => [t.name, t]));
    this.paid = deps.tools.filter((t) => t.paid);
  }

  /** The tools/list entries (the quote tool only when a paid tool is listed). */
  listTools(): object[] {
    const tools: object[] = this.deps.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations }));
    if (this.paid.length > 0) {
      tools.push({
        name: QUOTE_TOOL,
        description: 'A free quote for a paid tool and its exact arguments. Returns the quoteId the paid call must carry.',
        inputSchema: {
          type: 'object',
          properties: {
            tool: { type: 'string', enum: this.paid.map((t) => t.name) },
            arguments: { type: 'object', description: 'The arguments the paid call will use (without quoteId).' },
          },
          required: ['tool', 'arguments'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      });
    }
    return tools;
  }

  private async callTool(name: string, input: Readonly<Record<string, unknown>>): Promise<object> {
    if (name === QUOTE_TOOL) {
      const target = this.byName.get(String(input['tool']));
      if (target === undefined || !target.paid) return textResult({ error: `${String(input['tool'])} is not a paid tool of this server.` }, true);
      const args = (input['arguments'] ?? {}) as Record<string, unknown>;
      toolArgv(target, { ...args, quoteId: 'quote' }); // the same argument checks as the paid call
      const q = await this.deps.quotes.issue(target.name, target.commandId, args);
      return textResult({ tool: target.name, quoteId: q.quoteId, quote: q.quote }, false);
    }
    const tool = this.byName.get(name);
    if (tool === undefined) throw Object.assign(new Error(`Unknown tool: ${name}`), { rpc: RPC.invalidParams });
    if (tool.paid) {
      try {
        await this.deps.quotes.admit(tool.name, tool.commandId, input);
      } catch (e) {
        if (e instanceof QuoteRefused) return textResult({ error: e.message, code: 'QUOTE_REQUIRED', freshQuote: e.fresh }, true);
        throw e;
      }
    }
    const argv = toolArgv(tool, input);
    // A paid call was confirmed by its quote; a mutating one by --allow-write (it is only listed with it).
    const run = await this.deps.runCli(argv, { confirm: tool.paid || tool.mutates });
    if (run.envelope === null) return textResult({ error: `The command printed no JSON document (exit ${run.code}).`, stderr: run.stderr.slice(-2000) }, true);
    return textResult(run.envelope, run.code !== 0);
  }

  /** One request or notification; returns the response, or null for a notification. */
  async handle(msg: unknown): Promise<object | null> {
    if (Array.isArray(msg)) return fail(null, RPC.invalidRequest, 'Batches are not supported (MCP 2025-06-18).');
    const m = (typeof msg === 'object' && msg !== null ? msg : {}) as Rpc;
    const isRequest = 'id' in m && m.id !== undefined;
    const id: Id = isRequest ? (m.id ?? null) : null;
    if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') return isRequest ? fail(id, RPC.invalidRequest, 'Not a JSON-RPC 2.0 request.') : null;
    if (!isRequest) return null; // notifications (initialized, cancelled): nothing to answer
    const params = (typeof m.params === 'object' && m.params !== null ? m.params : {}) as Record<string, unknown>;
    try {
      switch (m.method) {
        case 'initialize':
          return ok(id, {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'revition', version: this.deps.serverVersion },
            instructions:
              'Revition platform operations as tools, under your own Revition session. Read-only unless started with --allow-write. Paid tools need revition_quote first.',
          });
        case 'ping':
          return ok(id, {});
        case 'tools/list':
          return ok(id, { tools: this.listTools() });
        case 'tools/call': {
          const name = params['name'];
          if (typeof name !== 'string') return fail(id, RPC.invalidParams, 'tools/call needs a tool name.');
          const args = params['arguments'];
          const input = (typeof args === 'object' && args !== null && !Array.isArray(args) ? args : {}) as Record<string, unknown>;
          try {
            return ok(id, await this.callTool(name, input));
          } catch (e) {
            const rpc = (e as { rpc?: number }).rpc;
            if (rpc !== undefined) return fail(id, rpc, (e as Error).message);
            return ok(id, textResult({ error: e instanceof Error ? e.message : String(e) }, true));
          }
        }
        default:
          return fail(id, RPC.methodNotFound, `Method not found: ${m.method}`);
      }
    } catch (e) {
      return fail(id, RPC.internal, e instanceof Error ? e.message : 'Internal error.');
    }
  }
}

/** Serves MCP over a line stream until the input ends. Every response is one line on `output`. */
export async function serveStdio(server: McpServer, input: Readable, output: Writable): Promise<void> {
  const rl = createInterface({ input, crlfDelay: Infinity });
  const pending = new Set<Promise<void>>();
  const send = (o: object): void => {
    output.write(`${JSON.stringify(o)}\n`);
  };
  for await (const line of rl) {
    if (line.trim() === '') continue;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      send(fail(null, RPC.parse, 'Parse error.'));
      continue;
    }
    // Requests run concurrently (a slow tool never blocks a ping); each answer is written when it is ready.
    const p = server.handle(msg).then((r) => {
      if (r !== null) send(r);
    });
    pending.add(p);
    void p.finally(() => pending.delete(p));
  }
  await Promise.all(pending);
}
