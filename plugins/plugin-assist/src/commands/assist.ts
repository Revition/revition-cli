import { Args, Flags } from '@oclif/core';
import {
  canPrompt,
  defaultCliPaths,
  EXIT,
  loadPolicy,
  onCancelCleanup,
  RevitionCliError,
  RevitionCommand,
  runtime,
  usageError,
  type CommandContext,
  type CommandMeta,
  type HumanView,
  type PermissionPolicy,
} from '@revition/cli-core';

import { StopSignal } from '../ui/interrupt.js';
import { ASSIST_NAME, type AssistEvent } from '../ui/render.js';
import { AssistRun, type SessionInfo, type SessionOut } from '../ui/session.js';

const seg = (s: string): string => encodeURIComponent(s);

/**
 * T3.3.3 - `revition assist ["goal"]` (also `corvito`): Revition Assist in the terminal. The model runs on the platform
 * (T3.3.1: Prism, Sentinel, the developer's wallet and the session's budget cap); this command shows each turn, runs
 * the local tools it requests under the permission policy (T3.3.2), and stops on Esc / Ctrl-C. Non-interactive use
 * (`--no-input`, `--json`, no terminal) is read-only analysis: `--mode edit` needs a terminal.
 */
export default class Assist extends RevitionCommand<SessionOut> {
  static override summary = `${ASSIST_NAME}: a terminal assistant for building on Revition.`;
  static override examples = [
    'revition assist "make the order-sync tests pass" --mode edit --budget 50',
    'revition assist "why does my build fail?" --budget 10',
    'revition assist "summarise this project" --mode ask --budget 5 --no-input --json',
    'corvito "add a retry to the webhook handler" --mode edit --budget 30',
  ];
  static meta: CommandMeta = {
    id: 'assist',
    summary: Assist.summary,
    examples: Assist.examples,
    requiredScopes: ['cli:assist'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.assist.v1',
    stability: 'beta',
  };
  static override args = { goal: Args.string({ description: 'What to work on (asked for when omitted on a terminal).' }) };
  static override flags = {
    mode: Flags.string({ options: ['ask', 'edit'], default: 'ask', description: 'ask: read-only analysis; edit: changes, each shown and confirmed.' }),
    budget: Flags.integer({ min: 1, description: 'The session budget cap in credits (enforced by the platform). Needed for a new session.' }),
    resume: Flags.string({ description: 'Continue an earlier session by its id.' }),
  };

  protected async run2(ctx: CommandContext): Promise<SessionOut> {
    const mode = ctx.commandFlags['mode'] === 'edit' ? 'edit' : 'ask';
    const budget = typeof ctx.commandFlags['budget'] === 'number' ? ctx.commandFlags['budget'] : null;
    const resume = typeof ctx.commandFlags['resume'] === 'string' ? ctx.commandFlags['resume'] : null;
    const goal = typeof ctx.args['goal'] === 'string' && ctx.args['goal'].trim() !== '' ? ctx.args['goal'].trim() : null;
    const interactive = canPrompt(ctx.io, { json: ctx.flags.json, noInput: ctx.flags.noInput });
    if (mode === 'edit' && !interactive) {
      throw usageError('EDIT_NEEDS_TERMINAL', 'Edit mode needs a terminal: every change is shown and confirmed.', 'Run it in a terminal, or use --mode ask for read-only analysis.');
    }
    if (resume === null && budget === null) throw usageError('BUDGET_REQUIRED', 'A new session needs a budget cap.', 'Add --budget <credits>, for example --budget 20.');
    if (!interactive && goal === null) throw usageError('GOAL_REQUIRED', 'Without a terminal the goal is the only message.', 'Pass it as the argument: revition assist "<goal>" ...');

    const rt = await runtime(ctx);
    if (rt.session.mode === 'none') throw new RevitionCliError({ code: 'AUTH_REQUIRED', message: 'You are not signed in.', hint: 'Run `revition login`.' }, EXIT.auth);
    const api = rt.session.client;
    const loaded = loadPolicy(process.cwd(), defaultCliPaths().configDir);
    // Ask mode is read-only whatever the policy file says.
    const policy: PermissionPolicy = mode === 'ask' ? { ...loaded, writeMode: 'never', execMode: 'never' } : loaded;

    const stop = new StopSignal();
    let inFlight: Promise<unknown> = Promise.resolve();
    // Off a raw-mode terminal, the shell's Ctrl-C runs this: stop, and wait (bounded) for the turn in flight.
    const unregister = onCancelCleanup(() => {
      stop.request();
      return inFlight.then(() => undefined, () => undefined);
    }, { budgetMs: 3000 });
    try {
      const run = new AssistRun({
        io: ctx.io,
        env: ctx.env,
        policy,
        interactive,
        json: ctx.flags.json,
        stop,
        ...(interactive ? { keys: process.stdin } : {}),
        createSession: async (body) => (await api.request<SessionInfo>({ method: 'POST', path: '/dev/assist/sessions', body })).body,
        sendTurn: (sessionId, body) => {
          const p = api.request<{ turn: number; status: string; events: AssistEvent[] }>({ method: 'POST', path: `/dev/assist/sessions/${seg(sessionId)}/turns`, body }).then((r) => r.body);
          inFlight = p;
          return p;
        },
      });
      return await run.run({ goal, mode, budgetCredits: budget, resume });
    } finally {
      unregister();
    }
  }

  protected override human(o: SessionOut): HumanView {
    return { text: `session ${o.sessionId}: ${o.turns} turn(s), ${o.status}${o.stoppedByUser ? ', stopped by you' : ''}\n` };
  }
}
