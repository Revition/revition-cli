import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { RevitionCliError } from '../errors/cli-error.js';

import { checkHost, credentialSlot } from './host-allowlist.js';
import { loadProjectFile, loadUserConfig, resolveSettings, type LayerInputs } from './load.js';
import { cliPaths } from './paths.js';
import { defaultUserConfig, UserConfigSchema } from './schema.js';
import { atomicWriteFile, secretRefusal, setConfigValue } from './write.js';

const USER = UserConfigSchema.parse({
  schemaVersion: 1,
  defaultProfile: 'work',
  profiles: { work: { host: 'user.revition.com', org: 'org_user' }, ci: { host: 'ci.revition.com' } },
  color: 'never',
});

function layers(over: Partial<LayerInputs> = {}): LayerInputs {
  return {
    flags: {},
    env: {},
    project: null,
    user: defaultUserConfig(),
    ...over,
  };
}

describe('T1.1.2 configuration', () => {
  it('[CLI-T1.1.2-AC1] precedence: each layer overrides the one below (flags > env > project > user > default)', () => {
    // profile: default -> user -> project -> env -> flag
    assert.deepEqual(resolveSettings(layers()).profile, { value: 'default', from: 'default' });
    assert.deepEqual(resolveSettings(layers({ user: USER })).profile, { value: 'work', from: 'user' });
    const project = { schemaVersion: 1 as const, appId: 'app_p', projectId: 'prj_p', profile: 'ci' };
    assert.deepEqual(resolveSettings(layers({ user: USER, project })).profile, { value: 'ci', from: 'project' });
    assert.deepEqual(
      resolveSettings(layers({ user: USER, project, env: { REVITION_PROFILE: 'work' } })).profile,
      { value: 'work', from: 'env' }
    );
    assert.deepEqual(
      resolveSettings(layers({ user: USER, project, env: { REVITION_PROFILE: 'work' }, flags: { profile: 'ci' } })).profile,
      { value: 'ci', from: 'flag' }
    );
    // host follows the chosen profile, then env, then flag
    assert.deepEqual(resolveSettings(layers({ user: USER })).host, { value: 'user.revition.com', from: 'user' });
    assert.deepEqual(
      resolveSettings(layers({ user: USER, env: { REVITION_HOST: 'env.revition.com' } })).host,
      { value: 'env.revition.com', from: 'env' }
    );
    assert.deepEqual(
      resolveSettings(layers({ user: USER, env: { REVITION_HOST: 'env.revition.com' }, flags: { host: 'flag.revition.com' } })).host,
      { value: 'flag.revition.com', from: 'flag' }
    );
    assert.deepEqual(resolveSettings(layers()).host, { value: 'api.revition.com', from: 'default' });
    // project ids: project file, overridden by env
    assert.deepEqual(resolveSettings(layers({ project })).appId, { value: 'app_p', from: 'project' });
    assert.deepEqual(resolveSettings(layers({ project, env: { REVITION_APP_ID: 'app_e' } })).appId, { value: 'app_e', from: 'env' });
    // color: user < env < flag
    assert.deepEqual(resolveSettings(layers({ user: USER })).color, { value: 'never', from: 'user' });
    assert.deepEqual(resolveSettings(layers({ user: USER, env: { REVITION_COLOR: 'always' } })).color, { value: 'always', from: 'env' });
    assert.deepEqual(
      resolveSettings(layers({ user: USER, env: { REVITION_COLOR: 'always' }, flags: { color: 'auto' } })).color,
      { value: 'auto', from: 'flag' }
    );
  });

  it('[CLI-T1.1.2-AC2] `config set token xyz` is refused (secret-looking key or value); nothing is set', () => {
    for (const key of ['token', 'apiToken', 'secret', 'password', 'api_key', 'profiles.default.session']) {
      assert.notEqual(secretRefusal(key, 'xyz'), null, key);
    }
    assert.notEqual(secretRefusal('profiles.default.org', 'rvt_abcdefghijklmnopqrstuvwxyzABCDEF0123'), null);
    assert.notEqual(secretRefusal('telemetry', 'Bearer abc.def'), null);
    assert.equal(secretRefusal('telemetry', 'off'), null);
    assert.throws(() => setConfigValue(defaultUserConfig(), 'token', 'xyz'), (e) => e instanceof RevitionCliError && e.exitCode === 2);
    // strict schema: an unknown key is an error, never stored
    assert.throws(() => setConfigValue(defaultUserConfig(), 'colour', 'never'), /not a config key/);
    assert.throws(() => UserConfigSchema.parse({ schemaVersion: 1, token: 'x' }));
    assert.equal(setConfigValue(defaultUserConfig(), 'telemetry', 'off').telemetry, 'off');
  });

  it('[CLI-T1.1.2-AC3] the paths are correct on all 3 OS', () => {
    const linux = cliPaths({ platform: 'linux', env: {}, home: '/home/u' });
    assert.equal(linux.configFile, '/home/u/.config/revition/config.json');
    assert.equal(linux.stateDir, '/home/u/.local/state/revition');
    assert.equal(linux.cacheDir, '/home/u/.cache/revition');
    const xdg = cliPaths({ platform: 'linux', env: { XDG_CONFIG_HOME: '/x/c', XDG_STATE_HOME: '/x/s', XDG_CACHE_HOME: '/x/k' }, home: '/home/u' });
    assert.deepEqual([xdg.configDir, xdg.stateDir, xdg.cacheDir], ['/x/c/revition', '/x/s/revition', '/x/k/revition']);
    const mac = cliPaths({ platform: 'darwin', env: {}, home: '/Users/u' });
    assert.equal(mac.configFile, '/Users/u/Library/Application Support/revition/config.json');
    assert.equal(mac.cacheDir, '/Users/u/Library/Caches/revition');
    const macXdg = cliPaths({ platform: 'darwin', env: { XDG_CONFIG_HOME: '/x/c' }, home: '/Users/u' });
    assert.equal(macXdg.configFile, '/x/c/revition/config.json');
    const win = cliPaths({
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' },
      home: 'C:\\Users\\u',
    });
    assert.equal(win.configFile, 'C:\\Users\\u\\AppData\\Roaming\\revition\\config.json');
    assert.equal(win.cacheDir, 'C:\\Users\\u\\AppData\\Local\\revition\\cache');
  });

  it('[CLI-T1.1.2-AC4] a custom host is refused without --allow-custom-host; with it a warning and a separate slot', () => {
    assert.equal(checkHost('api.revition.com', false).custom, false);
    assert.equal(checkHost('staging.api.revition.com', false).warning, null);
    for (const bad of ['evil.com', 'revition.com.evil.com', 'api.revition.co', 'apirevition.com']) {
      assert.throws(() => checkHost(bad, false), (e) => e instanceof RevitionCliError && e.exitCode === 2, bad);
    }
    const custom = checkHost('localhost', true);
    assert.equal(custom.custom, true);
    assert.match(custom.warning ?? '', /custom host/);
    assert.notEqual(credentialSlot('default', 'localhost'), credentialSlot('default', 'api.revition.com'));
  });

  it('[CLI-T1.1.2-AC5] concurrent writes never corrupt the file (atomic rename); mode 0600', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'revcfg-'));
    const file = join(dir, 'config.json');
    const writers = Array.from({ length: 40 }, (_, i) =>
      atomicWriteFile(file, `${JSON.stringify({ ...defaultUserConfig(), defaultProfile: `p${i}`, pad: 'x'.repeat(20_000) })}\n`)
    );
    // A reader racing the writers only ever sees a whole document.
    const reads = Array.from({ length: 40 }, async () => {
      const text = await readFile(file, 'utf8').catch(() => null);
      if (text !== null) JSON.parse(text);
    });
    await Promise.all([...writers, ...reads]);
    const final = JSON.parse(await readFile(file, 'utf8')) as { defaultProfile: string };
    assert.match(final.defaultProfile, /^p\d+$/);
    assert.deepEqual((await readdir(dir)).filter((f) => f.endsWith('.tmp')), []);
    if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
  });

  it('[CLI-T1.1.2-AC5] a corrupt config: a clear error naming `config path` and a backup of the file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'revcfg-'));
    const file = join(dir, 'config.json');
    await writeFile(file, '{ not json');
    await assert.rejects(loadUserConfig(file), (e) => e instanceof RevitionCliError && /config path/.test(e.error.hint ?? ''));
    assert.ok((await readdir(dir)).some((f) => f.startsWith('config.json.corrupt-')));
    await writeFile(file, JSON.stringify({ schemaVersion: 1, token: 'x' }));
    await assert.rejects(loadUserConfig(file), /cannot be used/);
    assert.deepEqual((await loadUserConfig(join(dir, 'missing.json'))).config, defaultUserConfig());
  });

  it('[CLI-T1.1.2-AC1] the project link file is found from a subdirectory and is strict', async () => {
    const root = await mkdtemp(join(tmpdir(), 'revprj-'));
    await atomicWriteFile(join(root, '.revition', 'project.json'), JSON.stringify({ schemaVersion: 1, appId: 'a', projectId: null }));
    const found = await loadProjectFile(join(root, 'src', 'deep'));
    assert.equal(found?.project.appId, 'a');
    await atomicWriteFile(join(root, '.revition', 'project.json'), JSON.stringify({ schemaVersion: 1, appId: 'a', projectId: null, token: 't' }));
    await assert.rejects(loadProjectFile(root), /not a valid project link file/);
  });
});
