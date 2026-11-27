import { RevitionCliError, type SessionClient } from '@revition/cli-core';

export type TokenState = 'valid' | 'invalid' | 'not_logged_in' | 'unreachable';

/**
 * T1.1.6 doctor "token validity via GET /dev/me" (REVITION-CLI-PLAN.md:959-960), over the run's OWN session: the
 * credential every other command would use (REVITION_TOKEN, else the profile's stored login, createSessionClient).
 * Reading REVITION_TOKEN alone reported "Not logged in" after every browser / device login (auditor #522). Only the
 * outcome comes back, never the credential.
 */
export async function sessionTokenState(session: Pick<SessionClient, 'mode' | 'client'>): Promise<TokenState> {
  if (session.mode === 'none') return 'not_logged_in';
  try {
    await session.client.request({ method: 'GET', path: '/dev/me' });
    return 'valid';
  } catch (e) {
    return e instanceof RevitionCliError && e.exitCode === 3 ? 'invalid' : 'unreachable';
  }
}
