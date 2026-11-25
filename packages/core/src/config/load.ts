import { copyFile, readFile } from 'node:fs/promises';
import { dirname, join, parse as parsePath } from 'node:path';

import { RevitionCliError } from '../errors/cli-error.js';
import { EXIT } from '../output/exit-codes.js';

import {
  defaultProfile,
  defaultUserConfig,
  migrate,
  ProjectFileSchema,
  UserConfigSchema,
  type Profile,
  type ProjectFile,
  type UserConfig,
} from './schema.js';
import { PROJECT_FILE } from './paths.js';

export type Layer = 'flag' | 'env' | 'project' | 'user' | 'default';

/** The settings a command sees, each with the layer it came from. */
export interface EffectiveSettings {
  readonly profile: { readonly value: string; readonly from: Layer };
  readonly host: { readonly value: string; readonly from: Layer };
  readonly org: { readonly value: string | null; readonly from: Layer };
  readonly authMethod: { readonly value: Profile['authMethod']; readonly from: Layer };
  readonly telemetry: { readonly value: UserConfig['telemetry']; readonly from: Layer };
  readonly updateCheck: { readonly value: boolean; readonly from: Layer };
  readonly color: { readonly value: UserConfig['color']; readonly from: Layer };
  readonly appId: { readonly value: string | null; readonly from: Layer };
  readonly projectId: { readonly value: string | null; readonly from: Layer };
}

export interface LayerInputs {
  readonly flags: Readonly<{ profile?: string; host?: string; org?: string; color?: UserConfig['color'] }>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly project: ProjectFile | null;
  readonly user: UserConfig;
}

/**
 * T1.1.2 - precedence, highest first: flags > env (REVITION_*) > project link file > user config > defaults.
 * PURE: the AC1 table test drives this directly.
 */
export function resolveSettings({ flags, env, project, user }: LayerInputs): EffectiveSettings {
  const pick = <V>(candidates: ReadonlyArray<readonly [V | undefined, Layer]>, fallback: V): { value: V; from: Layer } => {
    for (const [v, from] of candidates) if (v !== undefined) return { value: v, from };
    return { value: fallback, from: 'default' };
  };
  const e = (k: string): string | undefined => {
    const v = env[`REVITION_${k}`];
    return v !== undefined && v !== '' ? v : undefined;
  };
  const profile = pick<string>(
    [
      [flags.profile, 'flag'],
      [e('PROFILE'), 'env'],
      [project?.profile, 'project'],
      [user.defaultProfile === 'default' ? undefined : user.defaultProfile, 'user'],
    ],
    'default'
  );
  const p: Profile | undefined = user.profiles[profile.value];
  const d = defaultProfile();
  const bool = (v: string | undefined): boolean | undefined => (v === undefined ? undefined : !/^(0|false|no|off)$/i.test(v));
  return {
    profile,
    host: pick<string>([[flags.host, 'flag'], [e('HOST'), 'env'], [p?.host, 'user']], d.host),
    org: pick<string | null>([[flags.org, 'flag'], [e('ORG'), 'env'], [p?.org ?? undefined, 'user']], null),
    authMethod: pick<Profile['authMethod']>(
      [
        [e('AUTH_METHOD') as Profile['authMethod'] | undefined, 'env'],
        [p?.authMethod, 'user'],
      ],
      d.authMethod
    ),
    telemetry: pick<UserConfig['telemetry']>(
      [
        [e('TELEMETRY') as UserConfig['telemetry'] | undefined, 'env'],
        [user.telemetry === 'unset' ? undefined : user.telemetry, 'user'],
      ],
      'unset'
    ),
    updateCheck: pick<boolean>([[bool(e('UPDATE_CHECK')), 'env'], [user.updateCheck === true ? undefined : false, 'user']], true),
    color: pick<UserConfig['color']>(
      [
        [flags.color, 'flag'],
        [e('COLOR') as UserConfig['color'] | undefined, 'env'],
        [user.color === 'auto' ? undefined : user.color, 'user'],
      ],
      'auto'
    ),
    appId: pick<string | null>([[e('APP_ID'), 'env'], [project?.appId ?? undefined, 'project']], null),
    projectId: pick<string | null>([[e('PROJECT_ID'), 'env'], [project?.projectId ?? undefined, 'project']], null),
  };
}

export interface LoadedUserConfig {
  readonly config: UserConfig;
  /** Set when the file could not be used (corrupt -> backed up; read-only home -> in memory). */
  readonly warning: string | null;
}

/**
 * Reads the user config. Missing file -> defaults. A corrupt or invalid file -> a clear error naming the file and
 * `revition config path`, after the bad file is copied to `<file>.corrupt-<time>` (T1.1.2 edge case).
 */
export async function loadUserConfig(file: string, now: () => Date = () => new Date()): Promise<LoadedUserConfig> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { config: defaultUserConfig(), warning: null };
    if (code === 'EACCES' || code === 'EPERM') {
      return { config: defaultUserConfig(), warning: `Cannot read ${file}; using an in-memory config for this run.` };
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw await corrupt(file, 'it is not valid JSON', now);
  }
  const v = (parsed as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (typeof v === 'number' && v > 1) {
    throw new RevitionCliError(
      {
        code: 'CONFIG_FROM_NEWER_CLI',
        message: `${file} was written by a newer Revition CLI (schemaVersion ${v}).`,
        hint: 'Upgrade the CLI (`revition upgrade`).',
      },
      EXIT.usage
    );
  }
  const result = UserConfigSchema.safeParse(migrate(parsed));
  if (!result.success) throw await corrupt(file, result.error.issues.map((i) => i.path.join('.') || i.message).join(', '), now);
  return { config: result.data, warning: null };
}

async function corrupt(file: string, why: string, now: () => Date): Promise<RevitionCliError> {
  const backup = `${file}.corrupt-${now().toISOString().replace(/[:.]/g, '-')}`;
  await copyFile(file, backup).catch(() => undefined);
  return new RevitionCliError(
    {
      code: 'CONFIG_INVALID',
      message: `The config file ${file} cannot be used: ${why}.`,
      hint: `A copy was saved to ${backup}. Fix or remove the file (\`revition config path\` shows where it is).`,
    },
    EXIT.usage
  );
}

/** The nearest `.revition/project.json` from `cwd` upwards, parsed; null when there is none. */
export async function loadProjectFile(cwd: string): Promise<{ readonly file: string; readonly project: ProjectFile } | null> {
  let dir = cwd;
  const root = parsePath(cwd).root;
  for (;;) {
    const file = join(dir, PROJECT_FILE);
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text !== null) {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new RevitionCliError(
          { code: 'PROJECT_FILE_INVALID', message: `${file} is not valid JSON.` },
          EXIT.usage
        );
      }
      const r = ProjectFileSchema.safeParse(raw);
      if (!r.success) {
        throw new RevitionCliError(
          { code: 'PROJECT_FILE_INVALID', message: `${file} is not a valid project link file.` },
          EXIT.usage
        );
      }
      return { file, project: r.data };
    }
    if (dir === root) return null;
    dir = dirname(dir);
  }
}
