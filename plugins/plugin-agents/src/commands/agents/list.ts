import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  atomicWriteFile,
  EXIT,
  RevitionCliError,
  RevitionCommand,
  renderTable,
  runtime,
  terminalTable,
  usageError,
  type ApiClient,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

import { canonical, type AgentDefinition, type DraftView } from '../../format.js';
import { validateLocal, type Finding } from '../../validate.js';

/**
 * T3.1.3 - the agents commands' shared plumbing: the signed-in client (a workspace API: an independent developer is
 * refused by the platform), a definition file read and checked locally, and the pull record that lets `push` send
 * the version it read (`baseVersion`, T3.1.2) and lets `pull` see local edits.
 */
export async function agentsApi(ctx: CommandContext): Promise<ApiClient> {
  const rt = await runtime(ctx);
  if (rt.session.mode === 'none') throw new RevitionCliError({ code: 'AUTH_REQUIRED', message: 'You are not signed in.', hint: 'Run `revition login`.' }, EXIT.auth);
  return rt.session.client;
}

export const seg = (s: string): string => encodeURIComponent(s);

export interface Deployment {
  readonly deploymentId: string;
  readonly name: string;
  readonly status?: string;
  readonly role?: string;
}

export async function getDraft(api: ApiClient, id: string): Promise<DraftView> {
  return (await api.request<{ draft: DraftView }>({ method: 'GET', path: `/deployments/${seg(id)}/draft` })).body.draft;
}

/** A definition file, read and checked locally (schema + secret scan); refused with every finding when it fails. */
export function readDefinition(file: string): { readonly definition: AgentDefinition; readonly warnings: readonly Finding[] } {
  if (!existsSync(file)) throw usageError('FILE_NOT_FOUND', `No such file: ${file}.`);
  const r = validateLocal(readFileSync(file, 'utf8'));
  if (!r.ok || r.definition === null) {
    const lines = r.problems.map((p) => `${p.line === null ? p.path : `line ${p.line}`}: ${p.message}`);
    throw new RevitionCliError({ code: 'DEFINITION_INVALID', message: `${file} is not a valid agent definition:\n  ${lines.join('\n  ')}`, hint: 'Run `revition agents validate` for the details.' }, EXIT.conflict);
  }
  return { definition: r.definition, warnings: r.warnings };
}

/** The pull record: `.revition/agents/<id>.json` (the draft version read and a hash of the body; no content). */
export interface PullRecord {
  readonly agentId: string;
  readonly version: number;
  readonly bodyHash: string;
}

export const bodyHash = (body: AgentDefinition['config']): string => createHash('sha256').update(canonical(body)).digest('hex');

export const pullRecordFile = (dir: string, agentId: string): string => join(dir, '.revition', 'agents', `${agentId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);

export function readPullRecord(dir: string, agentId: string): PullRecord | null {
  const f = pullRecordFile(dir, agentId);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as PullRecord;
  } catch {
    return null;
  }
}

export async function writePullRecord(dir: string, r: PullRecord): Promise<void> {
  await atomicWriteFile(pullRecordFile(dir, r.agentId), `${JSON.stringify(r, null, 2)}\n`);
}

export const projectDir = (): string => resolve(process.cwd());

interface Out {
  readonly agents: readonly Deployment[];
}

export default class AgentsList extends RevitionCommand<Out> {
  static override summary = "Your workspace's agents.";
  static override examples = ['revition agents list', 'revition agents list --json'];
  static meta: CommandMeta = {
    id: 'agents:list',
    summary: AgentsList.summary,
    examples: AgentsList.examples,
    requiredScopes: ['cli:agents'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.agents.list.v1',
    stability: 'beta',
  };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const api = await agentsApi(ctx);
    return { agents: (await api.request<{ items: Deployment[] }>({ method: 'GET', path: '/deployments' })).body.items };
  }

  protected override human(o: Out): HumanView {
    if (o.agents.length === 0) return { text: 'No agents in this workspace yet. Create one with `revition agents create <file>`.\n' };
    return {
      text: renderTable(
        ['id', 'name', 'status'],
        o.agents.map((a) => [a.deploymentId, a.name, a.status ?? '-']),
        terminalTable()
      ),
    };
  }
}
