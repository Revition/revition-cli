// T1.5.2 AC2 (REVITION-CLI-PLAN.md:1820): "A stable publish is blocked until 2 approvals in release-approval (the publish
// job never starts before)." A GitHub environment's required reviewers need only ONE approval, so the gate is two
// environments in sequence (release-approval, then release-approval-2, each with required reviewers and "Prevent
// self-review"), and this step, run in the second job, fails unless the two approvals came from two DIFFERENT people
// (user ruling 2026-11-23). It reads the run's approvals API (GET /repos/{repo}/actions/runs/{run_id}/approvals) with
// the job's own token (actions: read). It changes nothing.
import { fileURLToPath } from 'node:url';

export const APPROVAL_ENVIRONMENTS = ['release-approval', 'release-approval-2'];

/**
 * Why the run is NOT approved by two different people (empty = approved). `approvals` is the API's answer:
 * [{ state: 'approved' | 'rejected', user: { login }, environments: [{ name }] }]. PURE.
 */
export function twoApproverProblems(approvals) {
  const [first, second] = APPROVAL_ENVIRONMENTS;
  const approvers = (env) =>
    new Set(
      (Array.isArray(approvals) ? approvals : [])
        .filter((a) => a?.state === 'approved' && (a.environments ?? []).some((e) => e?.name === env))
        .map((a) => String(a?.user?.login ?? ''))
        .filter((login) => login !== '')
    );
  const a = approvers(first);
  const b = approvers(second);
  const problems = [];
  if (a.size === 0) problems.push(`no approval in ${first}`);
  if (b.size === 0) problems.push(`no approval in ${second}`);
  if (a.size > 0 && b.size > 0 && ![...a].some((x) => [...b].some((y) => y !== x))) {
    problems.push(`the same person approved both ${first} and ${second}: two different people must approve`);
  }
  return problems;
}

async function main() {
  const api = process.env.GITHUB_API_URL ?? 'https://api.github.com';
  const url = `${api}/repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}/approvals`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    process.stderr.write(`two-approvers: the approvals API answered ${res.status}; refusing (fail closed)\n`);
    process.exit(1);
  }
  const problems = twoApproverProblems(await res.json());
  if (problems.length > 0) {
    for (const p of problems) process.stderr.write(`two-approvers: ${p}\n`);
    process.exit(1);
  }
  process.stdout.write('two-approvers: approved by two different people\n');
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) await main();
