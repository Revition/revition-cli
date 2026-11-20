import { z } from 'zod';

/**
 * T1.1.2 - the user config. Strict: unknown keys are an error, and there is NO token field, ever (credentials live in
 * the credential store, T1.3.1).
 */
export const ProfileSchema = z
  .object({
    /** Validated against the host allowlist (host-allowlist.ts). */
    host: z.string().regex(/^[a-z0-9.-]+$/).default('api.revition.com'),
    /** The last selected org (the server re-validates it). */
    org: z.string().nullable().default(null),
    authMethod: z.enum(['browser', 'device', 'token']).default('browser'),
  })
  .strict();
export type Profile = z.infer<typeof ProfileSchema>;

export const UserConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    defaultProfile: z.string().default('default'),
    profiles: z.record(z.string(), ProfileSchema).default({}),
    telemetry: z.enum(['unset', 'on', 'off']).default('unset'),
    updateCheck: z.boolean().default(true),
    color: z.enum(['auto', 'always', 'never']).default('auto'),
  })
  .strict();
export type UserConfig = z.infer<typeof UserConfigSchema>;

/**
 * `.revition/project.json` - safe to commit (no secrets allowed). NOT `./revition.json`, which is the platform's own
 * project manifest; the `.revition/` directory is never uploaded to a cloud project (T2.1.2).
 */
export const ProjectFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    appId: z.string().nullable(),
    projectId: z.string().nullable(),
    profile: z.string().optional(),
  })
  .strict();
export type ProjectFile = z.infer<typeof ProjectFileSchema>;

export const CURRENT_SCHEMA_VERSION = 1;

export function defaultUserConfig(): UserConfig {
  return UserConfigSchema.parse({ schemaVersion: 1 });
}

export function defaultProfile(): Profile {
  return ProfileSchema.parse({});
}

/**
 * Schema migration: a config written by an older CLI is upgraded in memory (and written back by the next `set`).
 * Version 1 is the first; a version this CLI does not know is refused (written by a NEWER CLI). PURE.
 */
export function migrate(raw: unknown): unknown {
  const v = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (v === undefined) return { ...(raw as object), schemaVersion: 1 };
  return raw;
}
