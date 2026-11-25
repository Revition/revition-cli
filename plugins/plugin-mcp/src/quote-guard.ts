/**
 * T3.2.2 - no blind spend over MCP: a paid tool runs only with the server-side quote id that `revition_quote` returned
 * in THIS session for exactly the same arguments, and only while a fresh quote still has that id (the platform's quote
 * ids are derived from what would run, so a change in between gives a new id). A quote is used once.
 */

/** Where a quote comes from: the platform's quote route, or the command's own free `--dry-run`. */
export interface QuoteDeps {
  /** A GET on the platform with the server's credential; returns the body. */
  readonly get: (path: string) => Promise<unknown>;
  /** Runs the command with `--dry-run --json` and returns its envelope `data`. */
  readonly dryRun: (commandId: string, input: Readonly<Record<string, unknown>>) => Promise<unknown>;
}

export interface Quote {
  readonly quoteId: string;
  readonly quote: unknown;
}

type QuoteSpec = (input: Readonly<Record<string, unknown>>, deps: QuoteDeps) => Promise<unknown>;

const seg = (v: unknown): string => {
  if (typeof v !== 'string' || v === '') throw new Error('A required id is missing.');
  return encodeURIComponent(v);
};

/**
 * How each paid command is quoted, for free. A paid command missing here is never exposed (fail closed).
 * The routes are the ones the commands themselves quote with (agents test, branches eval) or their `--dry-run`.
 */
export const PAID_QUOTE_SPECS: Readonly<Record<string, QuoteSpec>> = {
  'agents:test': (input, d) => d.get(`/deployments/${seg(input['id'])}/tests/quote`),
  'branches:eval': (input, d) => d.get(`/deployments/${seg(input['agent'])}/code-branches/${seg(input['branch'])}/pipeline-quote`),
  'eval:run': async (input, d) => {
    const data = (await d.dryRun('eval:run', input)) as { quote?: unknown } | null;
    return data?.quote;
  },
};

/** Sorted-key JSON of the call's arguments, without the quote id. PURE. */
export function argsKey(toolName: string, input: Readonly<Record<string, unknown>>): string {
  const keys = Object.keys(input).filter((k) => k !== 'quoteId').sort();
  return JSON.stringify([toolName, keys.map((k) => [k, input[k]])]);
}

function quoteIdOf(q: unknown): string {
  const id = (q as { quoteId?: unknown } | null | undefined)?.quoteId;
  if (typeof id !== 'string' || id === '') throw new Error('The platform returned no quote id.');
  return id;
}

export class QuoteRefused extends Error {
  constructor(
    message: string,
    readonly fresh: Quote | null
  ) {
    super(message);
  }
}

export class QuoteGuard {
  /** argsKey -> the quote id issued for it in this session (unused). */
  private readonly issued = new Map<string, string>();

  constructor(private readonly deps: QuoteDeps) {}

  private async quoteNow(commandId: string, input: Readonly<Record<string, unknown>>): Promise<Quote> {
    const spec = PAID_QUOTE_SPECS[commandId];
    if (spec === undefined) throw new Error(`${commandId} cannot be quoted.`);
    const quote = await spec(input, this.deps);
    return { quoteId: quoteIdOf(quote), quote };
  }

  /** `revition_quote`: a free quote for this tool and these arguments; remembered for one paid call. */
  async issue(toolName: string, commandId: string, input: Readonly<Record<string, unknown>>): Promise<Quote> {
    const q = await this.quoteNow(commandId, input);
    this.issued.set(argsKey(toolName, input), q.quoteId);
    return q;
  }

  /** Before a paid call: refuses (QuoteRefused) unless the call carries a valid, current quote id; then uses it up. */
  async admit(toolName: string, commandId: string, input: Readonly<Record<string, unknown>>): Promise<void> {
    const given = input['quoteId'];
    if (typeof given !== 'string' || given === '') {
      throw new QuoteRefused(`${toolName} is paid: call revition_quote with the same arguments first and pass its quoteId.`, null);
    }
    const key = argsKey(toolName, input);
    if (this.issued.get(key) !== given) {
      throw new QuoteRefused(`quoteId ${given} was not issued by revition_quote in this session for these arguments.`, null);
    }
    const fresh = await this.quoteNow(commandId, input);
    if (fresh.quoteId !== given) {
      this.issued.set(key, fresh.quoteId);
      throw new QuoteRefused(`The quote changed (now ${fresh.quoteId}); review it and call again with the new quoteId.`, fresh);
    }
    this.issued.delete(key);
  }
}
