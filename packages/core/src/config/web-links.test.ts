import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { reuseHint, sessionsPageUrl, SESSIONS_PAGE_URL } from '../auth/reauth.js';

import { UserConfigSchema } from './schema.js';
import { isWebLink, PRODUCTION_WEB_LINKS, webLinksFor } from './web-links.js';
import { flattenConfig, setConfigValue } from './write.js';

// Plan amendment 2026-11-27 (auditor ruling #537, REVITION-CLI-PLAN.md:1391 "manage at <portal url>"): every web link
// comes from the profile's optional `webOrigin`; absent = the production hosts, unchanged.
describe('web links per profile (plan amendment 2026-11-27)', () => {
  it('[CLI-T1.3.1-AC6] a profile without webOrigin keeps the production links, unchanged', () => {
    assert.equal(webLinksFor(undefined), PRODUCTION_WEB_LINKS);
    assert.equal(webLinksFor(null), PRODUCTION_WEB_LINKS);
    assert.equal(PRODUCTION_WEB_LINKS.developer, 'https://developer.revition.com');
    assert.equal(PRODUCTION_WEB_LINKS.app, 'https://app.revition.com');
    assert.equal(SESSIONS_PAGE_URL, 'https://developer.revition.com/cli-sessions');
    assert.ok(isWebLink('https://app.revition.com/foundry/agents/x', PRODUCTION_WEB_LINKS));
  });

  it('[CLI-T1.3.1-AC6] the staging profile prints and opens staging pages (its own webOrigin)', () => {
    const staging = webLinksFor('https://staging.revition.com');
    assert.equal(staging.developer, 'https://staging.revition.com/developer');
    assert.equal(staging.app, 'https://staging.revition.com');
    assert.equal(sessionsPageUrl(staging), 'https://staging.revition.com/developer/cli-sessions');
    assert.ok(reuseHint(staging).endsWith('review sessions at https://staging.revition.com/developer/cli-sessions.'));
    assert.ok(isWebLink('https://staging.revition.com/developer/apps', staging));
    // A staging profile never hands the user a production page, and the reverse.
    assert.equal(isWebLink('https://developer.revition.com/apps', staging), false);
    assert.equal(isWebLink('https://staging.revition.com/developer/apps', PRODUCTION_WEB_LINKS), false);
  });

  it('[CLI-T1.3.1-AC6] a non-Revition or non-https web origin is refused, in the helper and in the config', () => {
    for (const bad of ['https://evil.example.com', 'http://staging.revition.com', 'https://staging.revition.com.evil.io', 'https://staging.revition.com/x']) {
      assert.throws(() => webLinksFor(bad), /not a Revition web origin/);
      assert.equal(UserConfigSchema.safeParse({ schemaVersion: 1, profiles: { staging: { webOrigin: bad } } }).success, false, bad);
    }
    assert.equal(UserConfigSchema.safeParse({ schemaVersion: 1, profiles: { staging: { webOrigin: 'https://staging.revition.com' } } }).success, true);
    assert.equal(isWebLink('javascript:alert(1)', PRODUCTION_WEB_LINKS), false);
    const empty = UserConfigSchema.parse({ schemaVersion: 1 });
    const cfg = setConfigValue(empty, 'profiles.staging.webOrigin', 'https://staging.revition.com');
    assert.equal(flattenConfig(cfg)['profiles.staging.webOrigin'], 'https://staging.revition.com');
    assert.throws(() => setConfigValue(empty, 'profiles.staging.webOrigin', 'https://evil.example.com'));
  });
});
