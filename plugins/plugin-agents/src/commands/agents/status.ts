import { Args } from '@oclif/core';
import { RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { envLines, environmentsOf, type EnvView } from './environments/list.js';
import { agentsApi, seg } from './list.js';
import type { DraftDiff } from './push.js';
import { latestReport, reportLines, type RunState, type TestsReport } from './test.js';

interface Out {
  readonly agentId: string;
  readonly draftVsLive: DraftDiff;
  readonly tests: { readonly report: TestsReport | null; readonly run: RunState | null };
  readonly environments: readonly EnvView[];
}

/**
 * T3.1.4 - `revition agents status <id>`: the draft against live, the latest Tests report and the environments with any
 * pending approval, each as the platform reports it. Go-live readiness is the Verification gate's decision when a
 * person publishes in the portal (no readiness route exists, none is invented).
 */
export default class AgentsStatus extends RevitionCommand<Out> {
  static override summary = "An agent's draft vs live, its latest Tests report and its environments.";
  static override examples = ['revition agents status dep_123', 'revition agents status dep_123 --json'];
  static meta: CommandMeta = {
    id: 'agents:status',
    summary: AgentsStatus.summary,
    examples: AgentsStatus.examples,
    requiredScopes: ['cli:agents'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.agents.status.v1',
    stability: 'beta',
  };
  static override args = { id: Args.string({ required: true, description: 'The agent (deployment id).' }) };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const id = String(ctx.args['id']);
    const api = await agentsApi(ctx);
    const [draftVsLive, tests, envs] = await Promise.all([
      api.request<DraftDiff>({ method: 'GET', path: `/deployments/${seg(id)}/draft/diff` }).then((r) => r.body),
      latestReport(api, id),
      environmentsOf(api, id),
    ]);
    return { agentId: id, draftVsLive, tests, environments: envs.environments };
  }

  protected override human(o: Out): HumanView {
    const run = o.tests.run;
    const lines = [
      `${o.agentId}: draft vs live: ${o.draftVsLive.changedSections.join(', ') || 'no difference'}`,
      ...(run === null ? [] : [`tests: ${run.status} (${run.done} of ${run.total})${run.reason === undefined ? '' : `: ${run.reason}`}`]),
      ...(o.tests.report === null ? ['tests: no report yet (revition agents test)'] : reportLines(o.tests.report)),
      ...envLines(o.environments),
      `Go live or promote in the portal: revition agents open ${o.agentId} --action publish`,
    ];
    return { text: `${lines.join('\n')}\n` };
  }
}
