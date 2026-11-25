// T1.2.1 (amended 2026-11-23, auditor audience ruling): the Auth0 audience comes from the host profile. Staging is served
// on api.revition.com but its Auth0 API is https://api-staging.revition.com; production and the default stay
// https://api.revition.com.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProfileSchema, UserConfigSchema } from '../config/schema.js';
import { flattenConfig, setConfigValue } from '../config/write.js';

import { authConfigFor } from './token-exchange.js';

describe('[CLI-T1.2.1-AC2] the audience per host profile', () => {
  it('[CLI-T1.2.1-AC2] the default and the production profile: https://<host> = https://api.revition.com', () => {
    assert.equal(authConfigFor('api.revition.com', {}).audience, 'https://api.revition.com');
    assert.equal(authConfigFor('api.revition.com', {}, undefined).audience, 'https://api.revition.com');
  });

  it('[CLI-T1.2.1-AC2] the staging profile carries its own audience', () => {
    const staging = ProfileSchema.parse({ host: 'api.revition.com', audience: 'https://api-staging.revition.com' });
    assert.equal(authConfigFor(staging.host, {}, staging.audience).audience, 'https://api-staging.revition.com');
  });

  it('[CLI-T1.2.1-AC2] REVITION_AUTH_AUDIENCE still overrides the profile (another tenant)', () => {
    const env = { REVITION_AUTH_AUDIENCE: 'https://other.example' };
    assert.equal(authConfigFor('api.revition.com', env, 'https://api-staging.revition.com').audience, 'https://other.example');
  });

  it('[CLI-T1.2.1-AC2] a profile audience must be a Revition https origin', () => {
    for (const bad of ['http://api-staging.revition.com', 'https://evil.com', 'https://revition.com.evil.com', 'api-staging.revition.com']) {
      assert.equal(ProfileSchema.safeParse({ audience: bad }).success, false, bad);
    }
    assert.equal(ProfileSchema.parse({}).audience, undefined);
  });

  it('[CLI-T1.2.1-AC2] `revition config set profiles.<name>.audience` sets, lists and refuses a bad value', () => {
    const base = UserConfigSchema.parse({ schemaVersion: 1 });
    const set = setConfigValue(setConfigValue(base, 'profiles.staging.host', 'api.revition.com'), 'profiles.staging.audience', 'https://api-staging.revition.com');
    assert.equal(set.profiles['staging']?.audience, 'https://api-staging.revition.com');
    assert.equal(flattenConfig(set)['profiles.staging.audience'], 'https://api-staging.revition.com');
    assert.throws(() => setConfigValue(set, 'profiles.staging.audience', 'https://evil.com'), /not a valid value/u);
    // A profile without its own audience lists no audience key (the default `https://<host>` applies).
    assert.equal('profiles.staging2.audience' in flattenConfig(setConfigValue(base, 'profiles.staging2.host', 'api.revition.com')), false);
  });
});
