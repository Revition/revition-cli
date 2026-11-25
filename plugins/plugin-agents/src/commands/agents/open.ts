import { Args, Flags } from '@oclif/core';
import { canOpenBrowser, EXIT, openBrowser, RevitionCliError, RevitionCommand, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

export const OPEN_ACTIONS = ['publish', 'promote'] as const;

/**
 * The portal page where a person publishes an agent's draft or promotes an environment: the agent's page, the same
 * page the server names when it refuses a CLI token on those routes (sentinel/cli-scopes human-only-routes.ts
 * portalUrlFor: `/deployments/...` -> `/foundry/agents/{id}`). PURE.
 */
export function agentPageUrl(agentId: string): string {
  return `https://app.revition.com/foundry/agents/${encodeURIComponent(agentId)}`;
}

/** Only Revition pages over https are opened. */
export function assertRevitionPage(url: string): string {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !['app.revition.com', 'developer.revition.com'].includes(u.host)) {
    throw new RevitionCliError({ code: 'URL_NOT_ALLOWED', message: `Refusing to open ${url}: not a Revition page.` }, EXIT.usage);
  }
  return u.toString();
}

interface Out {
  readonly agentId: string;
  readonly action: (typeof OPEN_ACTIONS)[number] | null;
  readonly url: string;
  readonly opened: boolean;
}

/** T3.1.4 - `revition agents open <id> [--action publish|promote]`: the human step's page (D9: the CLI never publishes). */
export default class AgentsOpen extends RevitionCommand<Out> {
  static override summary = "Open the agent's portal page, where a person publishes the draft or promotes an environment.";
  static override examples = ['revition agents open dep_123 --action publish'];
  static meta: CommandMeta = {
    id: 'agents:open',
    summary: AgentsOpen.summary,
    examples: AgentsOpen.examples,
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.agents.open.v1',
    stability: 'beta',
  };
  static override args = { id: Args.string({ required: true, description: 'The agent (deployment id).' }) };
  static override flags = { action: Flags.option({ options: OPEN_ACTIONS, description: 'The human step you will take there.' })() };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const agentId = String(ctx.args['id']);
    const a = ctx.commandFlags['action'];
    const url = assertRevitionPage(agentPageUrl(agentId));
    const opened = !ctx.flags.json && canOpenBrowser(ctx.env, process.platform) ? await openBrowser(url) : false;
    return { agentId, action: OPEN_ACTIONS.find((x) => x === a) ?? null, url, opened };
  }

  protected override human(o: Out): HumanView {
    return { text: `${o.opened ? 'Opened' : 'Open'} ${o.url}${o.action === null ? '' : ` to ${o.action}`} (a person does it there).\n` };
  }
}
