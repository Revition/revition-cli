import {
  RevitionCliError,
  RevitionCommand,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

import { runtime } from '../../runtime.js';

/** The flag this test command sits behind (platform `cli-flags/flags.ts`: default off, on for one test org). */
export const PROBE_FLAG = 'cli-flag-probe';

export interface FlagsProbeOut {
  readonly flag: string;
  readonly enabled: boolean;
}

/**
 * T1.4.3 L4 (REVITION-CLI-PLAN.md:1720-1730; auditor ruling G4, 2026-11-24): a hidden, read-only test command behind a
 * server-delivered flag. Off for the caller, the CLI hides it and refuses it ("not available on your account yet");
 * forced on client-side (a hand-edited flag cache), the PLATFORM still refuses: GET /dev/cli/flags?require=<flag>
 * answers 403 CLI_FEATURE_DISABLED unless the flag is on for the caller's org (R1: flags are UX gates only). No side
 * effect beyond that one read.
 */
export default class FlagsProbe extends RevitionCommand<FlagsProbeOut> {
  static override hidden = true;
  static override summary = 'Check that the cli-flag-probe test feature is on for this account.';
  static override examples = ['revition flags probe', 'revition flags probe --json'];
  static meta: CommandMeta = {
    id: 'flags:probe',
    summary: FlagsProbe.summary,
    examples: FlagsProbe.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.flags.probe.v1',
    stability: 'beta',
    featureFlag: PROBE_FLAG,
  };

  protected async run2(ctx: CommandContext): Promise<FlagsProbeOut> {
    const rt = await runtime(ctx);
    if (rt.session.mode === 'none') {
      throw new RevitionCliError({ code: 'AUTH_REQUIRED', message: 'You are not signed in.', hint: 'Run `revition login`.' }, 3);
    }
    // The platform's own check: a 403 here maps to exit 4 with the platform's code (CLI_FEATURE_DISABLED).
    await rt.session.client.request<{ flags: Record<string, boolean>; ttl: number }>({
      method: 'GET',
      path: '/dev/cli/flags',
      query: { require: PROBE_FLAG },
    });
    return { flag: PROBE_FLAG, enabled: true };
  }

  protected override human(o: FlagsProbeOut): HumanView {
    return { text: `${o.flag} is on for this account.\n` };
  }
}
