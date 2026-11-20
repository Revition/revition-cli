import { resolve } from 'node:path';

import { Flags } from '@oclif/core';
import { EXIT, RevitionCliError, RevitionCommand, usageError, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi, seg } from '../api.js';
import { readLink } from '../project/project-link.js';

/**
 * T2.3.3 - `revition submit`: a version of the saved cloud project goes to review. The platform runs the automatic
 * checks (scan, compatibility, policy, eval gate) and then the manual review (Relay). Publishing is a human step in
 * the portal (D9): no CLI module calls the publish route, and the server refuses a CLI token on it.
 */
export const SUBMISSION_STATES = ['submitted', 'auto_checks', 'in_review', 'changes_requested', 'approved', 'certified', 'published', 'rejected'] as const;

export interface SubmissionView {
  readonly submissionId: string;
  readonly appId: string;
  readonly version: string;
  readonly state: (typeof SUBMISSION_STATES)[number];
  readonly projectId: string;
  readonly projectVersion: number;
  readonly autoResults: Readonly<Record<string, unknown>>;
  readonly reviewNotes: readonly string[];
  readonly certification?: { readonly badges: readonly string[]; readonly certifiedAt: string } | null;
  readonly history: readonly { readonly state: string; readonly at: string; readonly reason: string }[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The developer portal's apps page: where a certified version is published by a human. */
export const PUBLISH_PAGE_URL = 'https://developer.revition.com/apps';

/** The lifecycle as the CLI shows it: every state change and its reason, the check results, the review outcome. */
export function submissionLines(s: SubmissionView): string[] {
  // The platform's CheckOutcome (submission/auto-checks.ts): pass, the reasons it failed, skipped after an earlier fail.
  const checks = Object.entries(s.autoResults).flatMap(([k, v]) => {
    const r = (v ?? {}) as { pass?: unknown; reasons?: unknown; skipped?: unknown };
    const verdict = r.skipped === true ? 'skipped (an earlier check failed)' : r.pass === true ? 'passed' : 'failed';
    const reasons = Array.isArray(r.reasons) ? r.reasons.filter((x): x is string => typeof x === 'string') : [];
    return [`  check ${k}: ${verdict}`, ...reasons.map((x) => `    ${x}`)];
  });
  return [
    `${s.appId} ${s.version}: ${s.state}${s.state === 'certified' ? ' - ready to publish' : ''}`,
    ...s.history.map((h) => `  ${h.at} ${h.state}${h.reason === '' ? '' : `: ${h.reason}`}`),
    ...checks,
    ...s.reviewNotes.map((n) => `  review: ${n}`),
    ...(s.certification === undefined || s.certification === null ? [] : [`  badges: ${s.certification.badges.join(', ')}`]),
    ...(s.state === 'certified' ? [`Publish it in the portal: revition submissions open ${s.version}`] : []),
  ];
}

export function appOf(ctx: CommandContext): string {
  const f = ctx.commandFlags;
  const dir = resolve(process.cwd(), typeof f['dir'] === 'string' ? f['dir'] : '.');
  const appId = typeof f['app'] === 'string' ? f['app'] : (readLink(dir)?.appId ?? null);
  if (appId === null) throw usageError('APP_REQUIRED', 'No app: this directory is not linked to one.', 'Pass --app <id> or run `revition link`.');
  return appId;
}

export default class Submit extends RevitionCommand<SubmissionView> {
  static override summary = 'Submit a version of the saved cloud project for review and certification.';
  static override examples = ['revition submit --version 1.2.0 --yes', 'revition submit --app dapp_123 --project dproj_1 --version 1.2.0 --yes'];
  static meta: CommandMeta = {
    id: 'submit',
    summary: Submit.summary,
    examples: Submit.examples,
    requiredScopes: ['cli:submit'],
    mutates: true,
    confirm: 'prompt',
    jsonSchemaId: 'revition.submit.v1',
    stability: 'stable',
  };
  static override flags = {
    app: Flags.string({ description: 'The app id (default: the linked app).' }),
    project: Flags.string({ description: 'The cloud project id (default: the linked project).' }),
    version: Flags.string({ description: 'The version to submit (x.y.z).', required: true }),
    dir: Flags.string({ description: 'The project directory (default: the current directory).' }),
  };

  protected async run2(ctx: CommandContext): Promise<SubmissionView> {
    const f = ctx.commandFlags;
    const appId = appOf(ctx);
    const dir = resolve(process.cwd(), typeof f['dir'] === 'string' ? f['dir'] : '.');
    const projectId = typeof f['project'] === 'string' ? f['project'] : (readLink(dir)?.projectId ?? null);
    if (projectId === null) throw usageError('NO_CLOUD_PROJECT', 'No cloud project: this directory is not linked to one.', 'Pass --project <id> or run `revition link --project <id>`.');
    const api = await devApi(ctx);
    try {
      return (await api.request<SubmissionView>({ method: 'POST', path: `/dev/apps/${seg(appId)}/submissions`, body: { version: f['version'], projectId } })).body;
    } catch (e) {
      if (e instanceof RevitionCliError && e.exitCode === EXIT.conflict) {
        throw new RevitionCliError({ ...e.error, hint: 'A version is submitted once: submit a higher version (see `revition submissions list`).' }, EXIT.conflict);
      }
      throw e;
    }
  }

  protected override human(s: SubmissionView): HumanView {
    return { text: `${[...submissionLines(s), `Follow it: revition submissions view ${s.version}`].join('\n')}\n` };
  }
}
