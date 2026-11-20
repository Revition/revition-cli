import { Args } from '@oclif/core';
import { RevitionCommand, renderTable, terminalTable, type ApiClient, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { agentsApi, seg } from '../list.js';

/** One environment as GET /deployments/{id}/environments lists it (foundry runtime/environments EnvState + pending). */
export interface EnvView {
  readonly env: string;
  readonly provisioned: boolean;
  readonly artifactRef: string | null;
  readonly promotedAt?: string;
  readonly approvedBy?: string;
  readonly pending: { readonly from: string; readonly to: string; readonly requestedBy: string; readonly requestedAt: string } | null;
}

export interface Environments {
  readonly managed: unknown;
  readonly environments: readonly EnvView[];
}

export async function environmentsOf(api: ApiClient, id: string): Promise<Environments> {
  return (await api.request<Environments>({ method: 'GET', path: `/deployments/${seg(id)}/environments` })).body;
}

/** Each environment as a line, the pending approval included. PURE. */
export function envLines(envs: readonly EnvView[]): string[] {
  return envs.map(
    (e) =>
      `${e.env}: ${e.provisioned ? (e.artifactRef ?? 'provisioned, empty') : 'not enabled'}${
        e.pending === null ? '' : ` - approval pending (${e.pending.from} -> ${e.pending.to}, requested by ${e.pending.requestedBy})`
      }`
  );
}

interface Out extends Environments {
  readonly agentId: string;
}

/** T3.1.4 - `revition agents environments list <id>`; promotion and approval are human steps in the portal (D9). */
export default class AgentsEnvironmentsList extends RevitionCommand<Out> {
  static override summary = "An agent's environments, what each runs, and any promotion waiting for approval.";
  static override examples = ['revition agents environments list dep_123', 'revition agents environments list dep_123 --json'];
  static meta: CommandMeta = {
    id: 'agents:environments:list',
    summary: AgentsEnvironmentsList.summary,
    examples: AgentsEnvironmentsList.examples,
    requiredScopes: ['cli:agents'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.agents.environments.list.v1',
    stability: 'beta',
  };
  static override args = { id: Args.string({ required: true, description: 'The agent (deployment id).' }) };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const id = String(ctx.args['id']);
    return { agentId: id, ...(await environmentsOf(await agentsApi(ctx), id)) };
  }

  protected override human(o: Out): HumanView {
    if (!o.environments.some((e) => e.provisioned)) {
      return { text: `Environments are not enabled for ${o.agentId}: an Owner or Admin enables them in the portal (revition agents open ${o.agentId} --action promote).\n` };
    }
    return {
      text: renderTable(
        ['env', 'runs', 'pending approval'],
        o.environments.map((e) => [e.env, e.provisioned ? (e.artifactRef ?? '-') : 'not enabled', e.pending === null ? '-' : `${e.pending.from} -> ${e.pending.to}`]),
        terminalTable()
      ),
    };
  }
}
