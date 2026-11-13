// T0.1.4 rules, run in CI on every PR:
//   1. every `uses:` of a remote action is pinned to a full 40-character commit SHA (a tag or a branch can move);
//   2. no workflow triggered by `pull_request_target` checks code out (that runs untrusted PR code with secrets).
// Local actions (`./...`) are allowed. A `docker://` image must be pinned by an `@sha256:` digest.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;

/** Every violation in one workflow file's text, as `file:line: reason`. */
export function findViolations(text, file) {
  const out = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = /^\s*-?\s*uses:\s*['"]?([^'"\s#]+)/.exec(line);
    if (m === null) return;
    const ref = m[1];
    if (ref.startsWith('./')) return;
    if (ref.startsWith('docker://')) {
      if (!/@sha256:[0-9a-f]{64}$/.test(ref)) out.push(`${file}:${i + 1}: docker image not pinned by digest: ${ref}`);
      return;
    }
    const at = ref.lastIndexOf('@');
    const version = at < 0 ? '' : ref.slice(at + 1);
    if (!SHA.test(version)) out.push(`${file}:${i + 1}: action not pinned to a full commit SHA: ${ref}`);
  });
  if (/^\s*pull_request_target\s*:/m.test(text) || /on:\s*\[?[^\]\n]*\bpull_request_target\b/.test(text)) {
    if (/uses:\s*['"]?actions\/checkout@/.test(text)) {
      out.push(`${file}: a pull_request_target workflow must not check code out`);
    }
  }
  return out;
}

/** Every workflow file under `<root>/.github/workflows`, checked. */
export function checkRepo(root) {
  const dir = join(root, '.github', 'workflows');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .flatMap((f) => findViolations(readFileSync(join(dir, f), 'utf8'), `.github/workflows/${f}`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = checkRepo(process.cwd());
  if (violations.length > 0) {
    console.error(violations.join('\n'));
    process.exit(1);
  }
  console.log('check-pinned-actions: every action is pinned to a commit SHA');
}
