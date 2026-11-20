// T1.2.1 (REVITION-CLI-PLAN.md:990-1062) against the REAL Auth0 tenant, with no credential and no state change beyond a
// pending device code that expires on its own (nothing is approved). Free (Auth0 only; no Revition API, no AWS).
//   node --test scripts/auth0-tenant.e2e.mjs
// AC1 is only partly observable from outside: the exact callback list, the public Native client (no client-credentials
// grant). Rotation, lifetimes and the confirmation prompt need the dashboard read-back (the user's screenshots).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { URLSearchParams } from 'node:url';

const DOMAIN = 'https://revition.us.auth0.com';
const CLIENT = 'ZQYQKypbAR6ZaSrw1EeHLRHaZNlLERqo'; // the "Revition CLI" public client id (a public identifier)
const AUD = 'https://api.revition.com';
const BASE20 = 'BCDFGHJKLMNPQRSTVWXZ';

async function authorize(port) {
  const q = new URLSearchParams({
    client_id: CLIENT,
    response_type: 'code',
    redirect_uri: `http://127.0.0.1:${port}/callback`,
    scope: 'openid',
    audience: AUD,
    code_challenge: 'x'.repeat(43),
    code_challenge_method: 'S256',
    state: 'probe',
  });
  const res = await globalThis.fetch(`${DOMAIN}/authorize?${q}`, { redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location') ?? '' };
}

describe('T1.2.1 the Auth0 "Revition CLI" application, read from the live tenant', () => {
  it('[CLI-T1.2.1-AC1] exactly the ten loopback callbacks 8976-8985 are registered; 8975 and 8986 are refused', async () => {
    for (let port = 8975; port <= 8986; port += 1) {
      const r = await authorize(port);
      const accepted = r.status === 302 && /\/u\/login/u.test(r.location) && !/error=/u.test(r.location);
      assert.equal(accepted, port >= 8976 && port <= 8985, `port ${port}: ${r.status} ${r.location.slice(0, 80)}`);
    }
  });

  it('[CLI-T1.2.1-AC1] a public Native client: the client-credentials grant is refused (no secret exists)', async () => {
    const res = await globalThis.fetch(`${DOMAIN}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT, audience: AUD }),
    });
    assert.ok(res.status === 401 || res.status === 403, `status ${res.status}`);
    const body = await res.json();
    assert.equal(typeof body.access_token, 'undefined', 'no token issued');
  });

  it('[CLI-T1.2.1-AC5] the device user code is BASE20 (no vowels, no digits), 8 letters, with a positive expiry', async () => {
    const res = await globalThis.fetch(`${DOMAIN}/oauth/device/code`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT, scope: 'openid profile email offline_access', audience: AUD }),
    });
    assert.equal(res.status, 200, 'the device grant is enabled for the CLI client');
    const body = await res.json();
    const letters = String(body.user_code ?? '').replace(/-/gu, '');
    assert.equal(letters.length, 8);
    assert.deepEqual([...letters].filter((c) => !BASE20.includes(c)), []);
    assert.ok(Number.isInteger(body.expires_in) && body.expires_in > 0);
  });
});
