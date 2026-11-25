import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Flags } from '@oclif/core';
import { RevitionCommand, usageError, type CommandContext, type CommandMeta, type HumanView } from '@revition/cli-core';

import { devApi, type AppRegistration } from '../../api.js';
import { parseScopes } from '../../apps/apps-api.js';

export default class AppsCreate extends RevitionCommand<AppRegistration> {
  static override summary = 'Register an app: its plugin manifest and the scopes it declares (the platform validates both).';
  static override examples = ['revition apps create --manifest app-manifest.json --scopes source:orders --yes'];
  static meta: CommandMeta = {
    id: 'apps:create',
    summary: AppsCreate.summary,
    examples: AppsCreate.examples,
    requiredScopes: ['cli:write'],
    mutates: true,
    confirm: 'prompt',
    jsonSchemaId: 'revition.apps.create.v1',
    stability: 'stable',
  };
  static override flags = {
    manifest: Flags.string({ required: true, description: 'A JSON file: pluginId, brand, category, description, version, dataClasses.' }),
    scopes: Flags.string({ description: 'Comma-separated scopes the app declares (platform permissions).' }),
  };

  protected async run2(ctx: CommandContext): Promise<AppRegistration> {
    let manifest: unknown;
    try {
      manifest = JSON.parse(readFileSync(resolve(process.cwd(), String(ctx.commandFlags['manifest'])), 'utf8'));
    } catch {
      throw usageError('MANIFEST_UNREADABLE', `--manifest ${String(ctx.commandFlags['manifest'])} is not a readable JSON file.`);
    }
    const api = await devApi(ctx);
    return (await api.request<AppRegistration>({ method: 'POST', path: '/dev/apps', body: { manifest, scopes: parseScopes(ctx.commandFlags['scopes']) } })).body;
  }

  protected override human(a: AppRegistration): HumanView {
    return { text: `Registered ${a.appId} (${a.manifestRef}), scopes: ${a.declaredScopes.join(', ') || '-'}.\n` };
  }
}
