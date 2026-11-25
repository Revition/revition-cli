/**
 * T3.3.3 - how a turn's events read in the terminal. Plain text (no colour or animation is needed to understand a
 * line), so the same lines serve accessible mode and transcripts.
 */

import { uiString } from '@revition/cli-core';

/** product.assistName (D10, from core's en.json): the assistant's name in the banner and help. */
export const ASSIST_NAME = uiString('product.assistName');

export type AssistEvent =
  | { readonly type: 'assistantText'; readonly text: string }
  | { readonly type: 'toolRequest'; readonly tool: string; readonly args: Readonly<Record<string, unknown>>; readonly reason: string }
  | { readonly type: 'done'; readonly reason: string }
  | { readonly type: 'costUpdate'; readonly turnCredits: number; readonly spentCredits: number; readonly budgetCredits: number; readonly remainingCredits: number }
  | { readonly type: 'toolRefused'; readonly tool: string; readonly route: string; readonly code: string; readonly reason: string };

export interface Spend {
  readonly spentCredits: number;
  readonly budgetCredits: number;
}

const credits = (n: number): string => `${Math.round(n * 100) / 100} credits`;

export function costLine(s: Spend): string {
  return `cost: ${credits(s.spentCredits)} of the ${credits(s.budgetCredits)} budget (${credits(Math.max(0, s.budgetCredits - s.spentCredits))} left)`;
}

function target(args: Readonly<Record<string, unknown>>): string {
  for (const k of ['path', 'command', 'query', 'route', 'op']) if (typeof args[k] === 'string') return ` ${String(args[k])}`;
  return '';
}

/** The lines one event prints (stderr for status lines, stdout for the assistant's text). PURE. */
export function renderEvent(e: AssistEvent): { readonly out: string; readonly err: string } {
  switch (e.type) {
    case 'assistantText':
      return { out: `${e.text}\n`, err: '' };
    case 'toolRequest':
      return { out: '', err: `[${e.tool}${target(e.args)}] ${e.reason}\n` };
    case 'toolRefused':
      return { out: '', err: `[${e.tool} ${e.route}] refused (${e.code}): ${e.reason}\n` };
    case 'costUpdate':
      return { out: '', err: `this turn: ${credits(e.turnCredits)}; ${costLine(e)}\n` };
    case 'done':
      return { out: '', err: `done: ${e.reason}\n` };
  }
}

export function banner(mode: 'ask' | 'edit', budgetCredits: number | null): string {
  const budget = budgetCredits === null ? 'the session budget' : `a ${credits(budgetCredits)} budget`;
  return `${ASSIST_NAME}, ${mode === 'edit' ? 'edit mode: every change is shown and needs your y' : 'ask mode: read-only'}, ${budget}. /help for commands, Ctrl-C or Esc to stop.\n`;
}
