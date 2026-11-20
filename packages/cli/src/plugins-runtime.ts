import { runtime, type CommandContext, type Runtime } from '@revition/cli-core';
import { platformPlugins, type ApiCall, type PluginIndex, type PublisherDirectory } from '@revition/cli-core/plugins';

/** T4.2.3 - what every `plugins` command needs: the signed-in client, the platform's registry index and publishers. */
export interface PluginsRuntime {
  readonly rt: Runtime;
  readonly platform: PluginIndex & PublisherDirectory;
  readonly configDir: string;
  /** Core's API call for a plugin (the credential stays here; the plugin gets only the response). */
  readonly api: (call: ApiCall) => Promise<{ readonly status: number; readonly body: unknown }>;
}

export async function pluginsRuntime(ctx: CommandContext): Promise<PluginsRuntime> {
  const rt = await runtime(ctx);
  const client = rt.session.client;
  return {
    rt,
    configDir: rt.paths.configDir,
    platform: platformPlugins(async <T>(r: { method: 'GET'; path: string }) => ({ body: (await client.request<T>(r)).body })),
    api: async (call) => {
      const r = await client.request<unknown>({
        method: call.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        path: call.path,
        ...(call.body === undefined ? {} : { body: call.body }),
      });
      return { status: r.status, body: r.body };
    },
  };
}
