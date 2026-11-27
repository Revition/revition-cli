import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Flags } from '@oclif/core';
import {
  canPrompt,
  confirmYes,
  EXIT,
  RevitionCliError,
  RevitionCommand,
  usageError,
  type ApiClient,
  type CommandContext,
  type CommandMeta,
  type HumanView,
  webLinksOf,
} from '@revition/cli-core';

import { devApi, seg } from '../../api.js';
import { landedRun, quoteText, reportText, type EvalJob, type EvalQuote, type EvalRun } from '../../eval/report.js';
import { readLink } from '../../project/project-link.js';

/** A suite is the PROJECT file evals/<suiteId>.json (the platform's EVAL_SUITE_PATH). */
const SUITE_FILE = /^evals\/([a-z0-9][a-z0-9-]{0,62})\.json$/;
const POLL_MS = 3_000;
const WAIT_MS = 15 * 60_000;

interface Out {
  readonly quote: EvalQuote;
  readonly dryRun: boolean;
  /** The local suite file was saved to the cloud project first (step 0). */
  readonly uploaded: boolean;
  readonly run: EvalRun | null;
  /** The run call timed out and this record was read back instead (never re-run). */
  readonly landedAfterTimeout: boolean;
}

interface CloudProject {
  readonly version: number;
  readonly files: Readonly<Record<string, string>>;
}

function suitesOf(names: readonly string[]): string[] {
  return names.map((n) => SUITE_FILE.exec(n)?.[1]).filter((x): x is string => x !== undefined);
}

function localSuites(dir: string): string[] {
  const d = join(dir, 'evals');
  if (!existsSync(d)) return [];
  return suitesOf(readdirSync(d).map((n) => `evals/${n}`));
}

/** The lines only in the cloud copy (-) and only in the local file (+). */
function lineDiff(cloud: string, local: string): string {
  const a = cloud.split('\n');
  const b = local.split('\n');
  const inA = new Set(a);
  const inB = new Set(b);
  return [...a.filter((l) => !inB.has(l)).map((l) => `- ${l}`), ...b.filter((l) => !inA.has(l)).map((l) => `+ ${l}`)].join('\n');
}

function isTimeout(e: unknown): boolean {
  return e instanceof RevitionCliError && (e.error.httpStatus === 504 || e.error.code === 'NETWORK_ERROR');
}

export default class EvalRunCommand extends RevitionCommand<Out> {
  static override summary = "Evaluate a suite: the quote first, then (confirmed) the run and the portal's uplift report.";
  static override examples = [
    'revition eval run --suite smoke --dry-run',
    'revition eval run --app dapp_123 --suite smoke --yes',
  ];
  static meta: CommandMeta = {
    id: 'eval:run',
    summary: EvalRunCommand.summary,
    examples: EvalRunCommand.examples,
    requiredScopes: ['cli:write'],
    // The quote is shown BEFORE the confirmation (and `--dry-run` stops there), so the command confirms itself after
    // the quote rather than through the pipeline's up-front prompt; non-interactive still needs --yes.
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.eval.run.v1',
    stability: 'beta',
    paid: { quote: 'required' },
  };
  static override flags = {
    app: Flags.string({ description: 'The app id (default: the linked app).' }),
    suite: Flags.string({ description: 'The suite: evals/<suite>.json (default: the only one).' }),
    dir: Flags.string({ description: 'The project directory (default: the current directory).' }),
    'dry-run': Flags.boolean({ description: 'Print the quote only: free, nothing runs.' }),
  };

  /** The profile's portal page for the human view of the run (plan amendment 2026-11-27, #537). */
  private portalUrl: string | undefined;

  protected async run2(ctx: CommandContext): Promise<Out> {
    this.portalUrl = `${(await webLinksOf(ctx)).developer}/apps`;
    const f = ctx.commandFlags;
    const dir = resolve(process.cwd(), typeof f['dir'] === 'string' ? f['dir'] : '.');
    const link = readLink(dir);
    const appId = typeof f['app'] === 'string' ? f['app'] : (link?.appId ?? null);
    const projectId = link?.projectId ?? null;
    if (appId === null) throw usageError('APP_REQUIRED', 'No app: this directory is not linked to one.', 'Pass --app <id> or run `revition link`.');
    if (projectId === null) {
      throw usageError('NO_CLOUD_PROJECT', 'This directory is not linked to a cloud project.', 'Run `revition link --project <id>` (or `revition init --project new`).');
    }
    const api = await devApi(ctx);
    const cloud = (await api.request<CloudProject>({ method: 'GET', path: `/dev/projects/${seg(projectId)}` })).body;
    const suiteId = pickSuite(f['suite'], [...new Set([...suitesOf(Object.keys(cloud.files)), ...localSuites(dir)])].sort());
    const dryRun = f['dry-run'] === true;
    // 0. A local suite that differs from the cloud project is saved first (the platform evaluates the SAVED project).
    const uploaded = await this.syncSuite(ctx, api, { dir, projectId, suiteId, cloud, dryRun });
    // 1. The quote: free and read only.
    const quote = (await api.request<EvalQuote>({ method: 'GET', path: `/dev/apps/${seg(appId)}/evals/quote`, query: { projectId, suiteId } })).body;
    if (dryRun) return { quote, dryRun, uploaded, run: null, landedAfterTimeout: false };
    if (!ctx.flags.json) ctx.io.err(`${quoteText(quote)}\n`);
    // 2. Confirmation: interactive, or --yes. Nothing is run or billed before it.
    await confirmRun(ctx);
    // 3. The run, against this quote.
    return { quote, dryRun, uploaded, ...(await this.runOnce(ctx, api, appId, quote)) };
  }

  private async syncSuite(
    ctx: CommandContext,
    api: ApiClient,
    s: { readonly dir: string; readonly projectId: string; readonly suiteId: string; readonly cloud: CloudProject; readonly dryRun: boolean }
  ): Promise<boolean> {
    const path = `evals/${s.suiteId}.json`;
    const file = join(s.dir, path);
    if (!existsSync(file)) return false;
    const local = readFileSync(file, 'utf8');
    const saved = s.cloud.files[path];
    if (saved === local) return false;
    ctx.io.err(`${path} differs from the cloud project:\n${saved === undefined ? `+ (new file)\n${local}` : lineDiff(saved, local)}\n`);
    if (s.dryRun) {
      ctx.warn(`Dry run: the quote is for the SAVED ${path}; the local changes are not uploaded.`);
      return false;
    }
    if (!ctx.flags.yes) {
      if (!canPrompt(ctx.io, { json: ctx.flags.json, noInput: ctx.flags.noInput })) {
        throw usageError('CONFIRMATION_REQUIRED', `Saving ${path} to the cloud project needs confirmation.`, 'Re-run with --yes.');
      }
      if (!(await confirmYes(ctx.io, `Save ${path} to the cloud project first?`))) {
        throw new RevitionCliError({ code: 'CANCELLED', message: 'Cancelled.' }, EXIT.cancelled);
      }
    }
    await api.request({
      method: 'PUT',
      path: `/dev/projects/${seg(s.projectId)}/files`,
      body: { files: { ...s.cloud.files, [path]: local }, baseVersion: s.cloud.version },
    });
    return true;
  }

  /** ONE run call. A timeout reads the runs back and shows the landed record; it never calls the run route again. */
  private async runOnce(
    ctx: CommandContext,
    api: ApiClient,
    appId: string,
    quote: EvalQuote
  ): Promise<{ readonly run: EvalRun; readonly landedAfterTimeout: boolean }> {
    const path = `/dev/apps/${seg(appId)}/evals`;
    let res: { readonly status: number; readonly body: EvalRun | { readonly jobId: string } };
    try {
      res = await api.request({ method: 'POST', path, body: { projectId: quote.projectId, suiteId: quote.suiteId, quoteId: quote.quoteId } });
    } catch (e) {
      if (e instanceof RevitionCliError && e.exitCode === EXIT.payment) {
        const portal = (await webLinksOf(ctx)).developer;
        throw new RevitionCliError({ ...e.error, hint: `The evaluation is billed to your developer wallet. Add funds in the Developer Portal: ${portal}` }, EXIT.payment);
      }
      if (!isTimeout(e)) throw e;
      const runs = (await api.request<{ runs: EvalRun[] }>({ method: 'GET', path })).body.runs;
      const landed = landedRun(runs, quote.suiteId, quote.digest);
      if (landed === null) {
        throw new RevitionCliError(
          { code: 'EVAL_OUTCOME_UNKNOWN', message: 'The run call timed out and no run has landed yet.', hint: 'Do not re-run (it is billed): check `revition eval list` in a few minutes.' },
          EXIT.network
        );
      }
      ctx.warn('The run call timed out; this is the run that landed (nothing was run again).');
      return { run: landed, landedAfterTimeout: true };
    }
    if (res.status !== 202) return { run: res.body as EvalRun, landedAfterTimeout: false };
    return { run: await awaitJob(ctx, api, path, (res.body as { jobId: string }).jobId), landedAfterTimeout: false };
  }

  protected override human(o: Out): HumanView {
    if (o.dryRun) return { text: `${quoteText(o.quote)}\nDry run: nothing ran or was billed.\n` };
    return { text: `${o.run === null ? '' : reportText(o.run, this.portalUrl)}\n` };
  }
}

function pickSuite(flag: unknown, suites: readonly string[]): string {
  if (typeof flag === 'string') {
    if (!SUITE_FILE.test(`evals/${flag}.json`)) throw usageError('INVALID_SUITE', `"${flag}" is not a suite name.`);
    return flag;
  }
  if (suites.length === 0) {
    throw usageError('NO_EVAL_SUITE', 'This project has no evaluation suite (evals/<name>.json).', 'Run `revition generate eval-suite <name>`.');
  }
  if (suites.length > 1) throw usageError('SUITE_REQUIRED', `This project has several suites: ${suites.join(', ')}.`, 'Pass --suite <name>.');
  return suites[0] as string;
}

async function confirmRun(ctx: CommandContext): Promise<void> {
  if (ctx.flags.yes) return;
  if (!canPrompt(ctx.io, { json: ctx.flags.json, noInput: ctx.flags.noInput })) {
    throw usageError('CONFIRMATION_REQUIRED', 'Running an evaluation is billed and needs confirmation.', 'Re-run with --yes (or --dry-run for the quote only).');
  }
  if (!(await confirmYes(ctx.io, 'Run this evaluation (billed to your developer wallet)?'))) {
    throw new RevitionCliError({ code: 'CANCELLED', message: 'Cancelled.' }, EXIT.cancelled);
  }
}

/** A 202: the platform runs the evaluation in the background; its job row closes `done` (run id) or `failed`. */
async function awaitJob(ctx: CommandContext, api: ApiClient, path: string, jobId: string): Promise<EvalRun> {
  ctx.io.err(`running in the background (job ${jobId})\n`);
  for (let waited = 0; waited <= WAIT_MS; waited += POLL_MS) {
    const job = (await api.request<{ job: EvalJob }>({ method: 'GET', path, query: { jobId } })).body.job;
    if (job.status === 'failed') {
      throw new RevitionCliError({ code: job.error, message: `The evaluation failed (${job.error}).` }, EXIT.conflict);
    }
    if (job.status === 'done') {
      const run = (await api.request<{ runs: EvalRun[] }>({ method: 'GET', path })).body.runs.find((r) => r.runId === job.runId);
      if (run === undefined) throw new RevitionCliError({ code: 'EVAL_RUN_MISSING', message: `Run ${job.runId} is not listed yet.`, hint: 'Run `revition eval list`.' }, EXIT.conflict);
      return run;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new RevitionCliError(
    { code: 'EVAL_STILL_RUNNING', message: `The evaluation is still running after ${WAIT_MS / 60_000} min.`, hint: 'Do not re-run: check `revition eval list` later.' },
    EXIT.network
  );
}
