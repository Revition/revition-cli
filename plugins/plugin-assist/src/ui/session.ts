import { appendFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { ask, confirmYes, matchesAny, redactSecrets, startProgress, type Io, type PermissionPolicy } from '@revition/cli-core';

import { undoLast } from '../executor/backup.js';
import { LocalExecutor, type ToolResult } from '../executor/executor.js';

import type { KeyInput, StopSignal } from './interrupt.js';
import { PatchRetryGuard } from './patch-retry-guard.js';
import { banner, costLine, renderEvent, type AssistEvent } from './render.js';
import { parseSlash, SLASH_HELP } from './slash.js';

/**
 * T3.3.3 - one Assist session in the terminal. Each turn's text and tool requests are shown as the turn returns (a
 * progress line while waiting, plain in accessible mode); each local tool request is decided by the executor's policy
 * (and the developer's y/n); Esc / Ctrl-C stops the session: no further turn is sent, and the turn in flight completes
 * and its charge is shown. The platform enforces the budget cap; the session shows it.
 */
export interface SessionInfo {
  readonly sessionId: string;
  readonly budgetCredits: number;
  readonly spentCredits: number;
  readonly status: string;
}

export interface TurnReply {
  readonly turn: number;
  readonly status: string;
  readonly events: readonly AssistEvent[];
}

export interface SessionDeps {
  readonly io: Io;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly policy: PermissionPolicy;
  readonly interactive: boolean;
  readonly json: boolean;
  readonly stop: StopSignal;
  readonly keys?: KeyInput;
  readonly createSession: (body: { projectContext: string; goal: string; mode: 'ask' | 'edit'; budgetCredits: number }) => Promise<SessionInfo>;
  readonly sendTurn: (sessionId: string, body: { userMessage: string; toolResults: readonly ToolResult[] }) => Promise<TurnReply>;
}

export interface SessionOut {
  readonly sessionId: string;
  readonly mode: 'ask' | 'edit';
  readonly turns: number;
  readonly status: string;
  readonly spentCredits: number | null;
  readonly budgetCredits: number | null;
  readonly stoppedByUser: boolean;
  readonly text: readonly string[];
  readonly actions: readonly { readonly tool: string; readonly ok: boolean; readonly error?: string }[];
}

/** What the platform is told about the project: the top-level names outside the deny list, never file content. */
export function projectSummary(policy: PermissionPolicy): string {
  const names = readdirSync(policy.root, { withFileTypes: true })
    .filter((d) => !matchesAny(d.name, policy.denyRead) && d.name !== '.git' && d.name !== 'node_modules')
    .map((d) => (d.isDirectory() ? `${d.name}/` : d.name))
    .sort()
    .slice(0, 200);
  return `project root entries: ${names.join(', ')}`;
}

/**
 * CLI-T3.4.1 AC1 (as_de5356ef, auditor #595): a refused step says why; a command that RAN and failed says its exit code
 * and the last line it printed, never the bare "not done" the developer could not act on. PURE.
 */
export function notDoneReason(res: ToolResult): string {
  if (res.error !== undefined) return res.error;
  const r = res.output as { readonly exitCode?: unknown; readonly output?: unknown; readonly timedOut?: unknown } | undefined;
  if (r === undefined || typeof r !== 'object' || !('exitCode' in r)) return 'not done';
  if (r.timedOut === true) return 'the command timed out';
  const last = typeof r.output === 'string' ? (r.output.trim().split('\n').pop() ?? '').slice(0, 160) : '';
  const code = r.exitCode === null ? 'it could not start' : `exit ${String(r.exitCode)}`;
  return last === '' ? `the command failed (${code})` : `the command failed (${code}): ${last}`;
}

export class AssistRun {
  private lastDiff: string | null = null;
  private spend: { spentCredits: number; budgetCredits: number } | null = null;
  private readonly text: string[] = [];
  private readonly actions: { tool: string; ok: boolean; error?: string }[] = [];
  private readonly retryGuard = new PatchRetryGuard();
  private turns = 0;
  private status = 'open';
  private readonly executor: LocalExecutor;

  constructor(private readonly d: SessionDeps) {
    this.executor = new LocalExecutor({
      policy: d.policy,
      approve: async (a) => {
        if (!d.interactive) return false;
        const q = a.kind === 'write' ? `Apply this change to ${a.path}? (${a.reason})` : `Run \`${a.command}\`? (${a.reason})`;
        return confirmYes(d.io, q);
      },
      show: (t) => {
        this.lastDiff = t;
        if (!d.json) d.io.err(t);
      },
    });
  }

  private say(s: { out: string; err: string }): void {
    if (this.d.json) return;
    if (s.out !== '') this.d.io.out(s.out);
    if (s.err !== '') this.d.io.err(s.err);
  }

  private transcript(sessionId: string, line: unknown): void {
    if (!this.d.policy.log) return;
    const dir = join(this.d.policy.root, '.revition', 'assist');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${sessionId}.ndjson`), `${redactSecrets(JSON.stringify(line))}\n`, { mode: 0o600 });
  }

  /** One turn, awaited to the end even when a stop is asked for meanwhile (the in-flight turn completes and is billed). */
  private async turn(sessionId: string, userMessage: string, toolResults: readonly ToolResult[]): Promise<TurnReply> {
    const progress = startProgress(this.d.io, this.d.env, this.d.json, 'thinking...');
    const unwatch = this.d.keys === undefined ? () => undefined : this.d.stop.watchKeys(this.d.keys, () => this.say({ out: '', err: '\nstopping: the turn in flight completes and is billed; no further turn is sent\n' }));
    try {
      const reply = await this.d.sendTurn(sessionId, { userMessage, toolResults });
      this.turns++;
      this.status = reply.status;
      progress.done('');
      this.transcript(sessionId, { turn: reply.turn, userMessage, events: reply.events });
      return reply;
    } finally {
      unwatch();
    }
  }

  /** The slash command's effect; returns true to end the session. */
  private async slash(cmd: ReturnType<typeof parseSlash>): Promise<boolean> {
    switch (cmd) {
      case 'exit':
        return true;
      case 'diff':
        this.say({ out: '', err: this.lastDiff ?? 'no change applied in this session\n' });
        return false;
      case 'undo': {
        const rel = await undoLast(this.d.policy.root);
        this.say({ out: '', err: rel === null ? 'nothing to undo\n' : `restored ${rel}\n` });
        if (rel !== null) this.actions.push({ tool: 'undo', ok: true });
        return false;
      }
      case 'cost':
        this.say({ out: '', err: `${this.spend === null ? 'no turn yet' : costLine(this.spend)}\n` });
        return false;
      case 'permissions': {
        const p = this.d.policy;
        this.say({ out: '', err: `root ${p.root}\nwrites: ${p.writeMode}; commands: ${p.execMode}${p.execMode === 'allowlist' ? ` (${p.execAllowlist.join(', ')})` : ''}; network for commands: ${p.network}\nnever read: ${p.denyRead.join(', ')}\n` });
        return false;
      }
      case 'help':
        this.say({ out: '', err: `${SLASH_HELP}\n` });
        return false;
      default:
        this.say({ out: '', err: `unknown command; ${SLASH_HELP.split('\n').map((l) => l.split(' ')[0]).join(' ')}\n` });
        return false;
    }
  }

  async run(o: { readonly goal: string | null; readonly mode: 'ask' | 'edit'; readonly budgetCredits: number | null; readonly resume: string | null }): Promise<SessionOut> {
    const d = this.d;
    let goal = o.goal;
    this.say({ out: '', err: banner(o.mode, o.budgetCredits) });
    if (goal === null && d.interactive) goal = (await ask(d.io, 'What should we work on? ')).trim();
    let sessionId: string;
    if (o.resume !== null) sessionId = o.resume;
    else {
      const s = await d.createSession({ projectContext: projectSummary(d.policy), goal: goal ?? '', mode: o.mode, budgetCredits: o.budgetCredits ?? 0 });
      sessionId = s.sessionId;
      this.spend = { spentCredits: s.spentCredits, budgetCredits: s.budgetCredits };
      this.say({ out: '', err: `session ${sessionId}\n` });
    }
    let message = goal ?? '';
    let results: ToolResult[] = [];
    for (;;) {
      const reply = await this.turn(sessionId, message, results);
      results = [];
      const requests: Extract<AssistEvent, { type: 'toolRequest' }>[] = [];
      let done = false;
      for (const e of reply.events) {
        this.say(renderEvent(e));
        if (e.type === 'assistantText') this.text.push(e.text);
        if (e.type === 'costUpdate') this.spend = { spentCredits: e.spentCredits, budgetCredits: e.budgetCredits };
        if (e.type === 'done') done = true;
        if (e.type === 'toolRequest' && e.tool !== 'platform_op') requests.push(e);
      }
      if (d.stop.requested || reply.status === 'budget_reached') break;
      if (requests.length > 0 && !done) {
        for (const r of requests) {
          if (d.stop.requested) break;
          const res = this.retryGuard.check(r) ?? (await this.executor.handle({ tool: r.tool, args: r.args, reason: r.reason }));
          this.retryGuard.note(r, res);
          this.actions.push({ tool: res.tool, ok: res.ok, ...(res.error === undefined ? {} : { error: res.error }) });
          if (!res.ok) this.say({ out: '', err: `  -> ${notDoneReason(res)}\n` });
          results.push(res);
        }
        if (d.stop.requested) break;
        message = '';
        continue;
      }
      if (!d.interactive) break;
      // The developer's next message, or a slash command.
      let next: string | null = null;
      while (next === null && !d.stop.requested) {
        const line = await ask(d.io, '> ');
        if (d.stop.requested) break;
        const cmd = parseSlash(line);
        if (cmd === null) {
          if (line.trim() !== '') next = line;
        }
        else if (await this.slash(cmd)) break;
      }
      if (next === null || d.stop.requested) break;
      message = next;
    }
    if (this.spend !== null) this.say({ out: '', err: `${costLine(this.spend)}\n` });
    return {
      sessionId,
      mode: o.mode,
      turns: this.turns,
      status: this.status,
      spentCredits: this.spend?.spentCredits ?? null,
      budgetCredits: this.spend?.budgetCredits ?? null,
      stoppedByUser: d.stop.requested,
      text: this.text,
      actions: this.actions,
    };
  }
}
