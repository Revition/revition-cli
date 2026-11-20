// T1.4.2 / T1.4.3 - the detached background work: argv = <task: telemetry|flags> <profile> <cli version>. It runs
// after a command has finished and never affects it; any failure is dropped.
import {
  channelOf,
  createSessionClient,
  defaultCliPaths,
  flushQueue,
  loadFlags,
  loadProjectFile,
  loadUserConfig,
  resolveSettings,
  selectStore,
} from '@revition/cli-core';

const [task, profileArg, version] = process.argv.slice(2);

async function session(): Promise<{ client: Awaited<ReturnType<typeof createSessionClient>>; profile: string; cacheDir: string; stateDir: string } | null> {
  const paths = defaultCliPaths();
  const { config } = await loadUserConfig(paths.configFile);
  const project = await loadProjectFile(process.cwd()).catch(() => null);
  const s = resolveSettings({ flags: { profile: profileArg }, env: process.env, project: project?.project ?? null, user: config });
  const profile = s.profile.value;
  const store = await selectStore({
    profile,
    stateDir: paths.stateDir,
    env: process.env,
    insecureStorageFlag: false,
    askPassphrase: async () => {
      throw new Error('no prompt in the background');
    },
  }).catch(() => null);
  const client = await createSessionClient({ profile, host: s.host.value, env: process.env, stateDir: paths.stateDir, cliVersion: version ?? '0.0.0', store, warn: () => undefined });
  return client.mode === 'none' ? null : { client, profile, cacheDir: paths.cacheDir, stateDir: paths.stateDir };
}

try {
  const s = await session();
  if (task === 'telemetry') {
    // Signed-out usage is not counted (by design: no unauthenticated endpoint exists).
    if (s !== null) {
      await flushQueue(s.stateDir, async (payload) => {
        await s.client.client.request({ method: 'POST', path: '/dev/cli/telemetry', body: payload });
      });
    }
  } else if (task === 'flags' && s !== null) {
    await loadFlags({ client: s.client.client, cacheDir: s.cacheDir, profile: s.profile, version: version ?? '0.0.0', channel: channelOf(version ?? '0.0.0'), now: Date.now() });
  }
} catch {
  // background work never surfaces
}
