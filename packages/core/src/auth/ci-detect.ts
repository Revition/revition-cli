/**
 * T1.3.6 - in CI nothing interactive runs: CI=true (or any of the common CI markers) or a non-TTY stdin implies
 * --no-input, so a missing confirmation is exit 2 with guidance, never a hang. PURE.
 */
export function isCi(env: Readonly<Record<string, string | undefined>>): boolean {
  const ci = (env['CI'] ?? '').toLowerCase();
  if (ci !== '' && ci !== '0' && ci !== 'false') return true;
  return ['GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'BUILDKITE', 'JENKINS_URL', 'TF_BUILD'].some((k) => (env[k] ?? '') !== '');
}

export function impliedNoInput(env: Readonly<Record<string, string | undefined>>, stdinIsTTY: boolean): boolean {
  return isCi(env) || !stdinIsTTY;
}
