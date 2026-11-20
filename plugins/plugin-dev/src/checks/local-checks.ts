/**
 * T2.1.2 - the local, free part of `revition build`: the platform's project layout rules
 * (devportal/authoring/project.ts) that need no server - the size limits, the required files, the manifest's shape and
 * capability count, each capability's source and tests, and no stray file. The field-level manifest schema
 * (each capability's upload fields) is NOT in the published contract, so it is the server check's
 * (`POST /dev/authoring/check`), which always runs when online. PURE.
 */
export const PROJECT_MANIFEST_PATH = 'revition.json';
export const LOCAL_ONLY_FILES: readonly string[] = ['fixtures.json', 'README.md'];
export const UI_MANIFEST_PATH = 'ui/manifest.json';
export const EVAL_SUITE_PATH = /^evals\/([a-z0-9][a-z0-9-]{0,62})\.json$/;
export const MAX_PROJECT_FILES = 32;
export const MAX_PROJECT_BYTES = 1_500_000;
export const MAX_CAPABILITIES = 5;
/** The platform's own map (runtime/code/coding-agent.ts SOURCE_EXT); any other language is `.txt`. */
const SOURCE_EXT: Readonly<Record<string, string>> = { python: 'py', ts: 'ts', wasm: 'wasm' };

export type CheckId = 'size' | 'manifest' | 'layout' | 'tests';

export interface Problem {
  readonly check: CheckId | 'server';
  readonly file: string;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}

type Files = Readonly<Record<string, string>>;

function parse(files: Files, file: string, out: Problem[], check: CheckId): unknown {
  try {
    return JSON.parse(files[file] ?? '') as unknown;
  } catch {
    out.push({ check, file, message: 'not valid JSON', severity: 'error' });
    return undefined;
  }
}

export function sizeProblems(files: Files): Problem[] {
  const names = Object.keys(files);
  if (names.length > MAX_PROJECT_FILES) {
    return [{ check: 'size', file: '(project)', message: `${names.length} files: the platform limit is ${MAX_PROJECT_FILES}`, severity: 'error' }];
  }
  const bytes = names.reduce((n, f) => n + Buffer.byteLength(f, 'utf8') + Buffer.byteLength(files[f] ?? '', 'utf8'), 0);
  return bytes > MAX_PROJECT_BYTES
    ? [{ check: 'size', file: '(project)', message: `${bytes} bytes: the platform limit is ${MAX_PROJECT_BYTES} bytes`, severity: 'error' }]
    : [];
}

interface ManifestCapability {
  readonly id: string;
  readonly entrypoint: string;
  readonly language: string;
}

/** The manifest's shape: an object with a summary and 1-5 capabilities, each with an id, a language and an entrypoint. */
export function manifestProblems(files: Files): { problems: Problem[]; capabilities: ManifestCapability[] } {
  const out: Problem[] = [];
  if (files[PROJECT_MANIFEST_PATH] === undefined) {
    return { problems: [{ check: 'manifest', file: PROJECT_MANIFEST_PATH, message: 'missing (run `revition init` to start a project)', severity: 'error' }], capabilities: [] };
  }
  const raw = parse(files, PROJECT_MANIFEST_PATH, out, 'manifest');
  if (raw === undefined) return { problems: out, capabilities: [] };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { problems: [{ check: 'manifest', file: PROJECT_MANIFEST_PATH, message: '(root): an object with summary and capabilities', severity: 'error' }], capabilities: [] };
  }
  const m = raw as Record<string, unknown>;
  if (typeof m['summary'] !== 'string' || m['summary'].length === 0 || m['summary'].length > 2000) {
    out.push({ check: 'manifest', file: PROJECT_MANIFEST_PATH, message: 'summary: 1 to 2000 characters', severity: 'error' });
  }
  const caps = m['capabilities'];
  if (!Array.isArray(caps) || caps.length < 1 || caps.length > MAX_CAPABILITIES) {
    out.push({ check: 'manifest', file: PROJECT_MANIFEST_PATH, message: `capabilities: 1 to ${MAX_CAPABILITIES} capabilities`, severity: 'error' });
    return { problems: out, capabilities: [] };
  }
  const capabilities: ManifestCapability[] = [];
  caps.forEach((c: unknown, i: number) => {
    const o = (c ?? {}) as Record<string, unknown>;
    const missing = ['id', 'language', 'entrypoint'].filter((k) => typeof o[k] !== 'string' || o[k] === '');
    if (missing.length > 0) {
      out.push({ check: 'manifest', file: PROJECT_MANIFEST_PATH, message: `capabilities.${i}: ${missing.join(', ')} required`, severity: 'error' });
      return;
    }
    capabilities.push({ id: String(o['id']), language: String(o['language']), entrypoint: String(o['entrypoint']) });
  });
  const ids = capabilities.map((c) => c.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup !== undefined) out.push({ check: 'manifest', file: PROJECT_MANIFEST_PATH, message: `capability ${dup} twice`, severity: 'error' });
  return { problems: out, capabilities };
}

export const sourcePath = (c: ManifestCapability): string => `capabilities/${c.id}/${c.entrypoint}.${SOURCE_EXT[c.language] ?? 'txt'}`;
export const testsPath = (id: string): string => `capabilities/${id}/tests.json`;

/** Each capability's source and tests (1-20 cases of {name, input, expect}); no file outside the layout. */
export function layoutProblems(files: Files, capabilities: readonly ManifestCapability[]): Problem[] {
  const out: Problem[] = [];
  const known = new Set<string>([PROJECT_MANIFEST_PATH, ...LOCAL_ONLY_FILES]);
  for (const c of capabilities) {
    const src = sourcePath(c);
    const tf = testsPath(c.id);
    known.add(src).add(tf);
    if (files[src] === undefined) out.push({ check: 'layout', file: src, message: "missing: the capability's source", severity: 'error' });
    if (files[tf] === undefined) {
      out.push({ check: 'tests', file: tf, message: 'missing: every capability ships at least one test', severity: 'error' });
      continue;
    }
    const tests = parse(files, tf, out, 'tests');
    if (tests === undefined) continue;
    if (!Array.isArray(tests) || tests.length < 1 || tests.length > 20) {
      out.push({ check: 'tests', file: tf, message: '1 to 20 test cases', severity: 'error' });
      continue;
    }
    tests.forEach((t: unknown, i: number) => {
      const o = (t ?? {}) as Record<string, unknown>;
      const extra = Object.keys(o).filter((k) => !['name', 'input', 'expect'].includes(k));
      if (typeof o['name'] !== 'string' || o['name'] === '' || !('input' in o) || !('expect' in o) || extra.length > 0) {
        out.push({ check: 'tests', file: tf, message: `${i}: a case is exactly {name, input, expect}`, severity: 'error' });
      }
    });
  }
  if (files[UI_MANIFEST_PATH] !== undefined) {
    known.add(UI_MANIFEST_PATH);
    parse(files, UI_MANIFEST_PATH, out, 'layout');
  }
  for (const f of Object.keys(files).filter((n) => !known.has(n) && !EVAL_SUITE_PATH.test(n))) {
    out.push({ check: 'layout', file: f, message: 'not part of an extension project', severity: 'error' });
  }
  return out;
}

/** Every local problem, in check order: size first (an oversized project is refused before anything else). */
export function localChecks(files: Files): Problem[] {
  const size = sizeProblems(files);
  if (size.length > 0) return size;
  const m = manifestProblems(files);
  if (m.problems.length > 0) return m.problems;
  return layoutProblems(files, m.capabilities);
}
