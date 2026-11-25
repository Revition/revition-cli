import { COMPONENT_SCHEMAS } from '@revition/api-client';
import { EXIT, RevitionCliError, usageError } from '@revition/cli-core';

import { EVAL_SUITE_PATH, PROJECT_MANIFEST_PATH, UI_MANIFEST_PATH } from '../checks/local-checks.js';

/**
 * T2.1.5 - each generator renders new files from the PLATFORM's own templates (a starter of the right extension point)
 * or the PLATFORM's published schema (EvalSuite); the CLI holds no template of its own. PURE.
 */
type Files = Readonly<Record<string, string>>;

export const KINDS = ['capability', 'test', 'eval-suite', 'ui-surface'] as const;
export type Kind = (typeof KINDS)[number];
const ID = /^[a-z][a-z0-9-]{0,62}$/;

export function assertId(what: string, value: string): string {
  if (!ID.test(value)) throw usageError('INVALID_NAME', `${what} "${value}" must be lowercase letters, digits and dashes (start with a letter).`);
  return value;
}

/** The starter's one capability, renamed to `name`: its files under capabilities/<name>/ and its manifest entry. */
export function renderCapability(starterFiles: Files, name: string): { files: Files; entry: Record<string, unknown> } {
  const manifest = JSON.parse(starterFiles[PROJECT_MANIFEST_PATH] ?? '{}') as { capabilities?: Array<Record<string, unknown>> };
  const source = manifest.capabilities?.[0];
  const from = typeof source?.['id'] === 'string' ? source['id'] : null;
  if (source === undefined || from === null) {
    throw new RevitionCliError({ code: 'STARTER_HAS_NO_CAPABILITY', message: 'The platform starter for that point has no capability to copy.' }, EXIT.general);
  }
  const prefix = `capabilities/${from}/`;
  const files: Record<string, string> = {};
  for (const [path, text] of Object.entries(starterFiles)) {
    if (path.startsWith(prefix)) files[`capabilities/${name}/${path.slice(prefix.length)}`] = text;
  }
  return { files, entry: { ...source, id: name, name } };
}

/** The UI surface: the custom_ui starter's ui/manifest.json, nothing else. */
export function renderUiSurface(starterFiles: Files): Files {
  const ui = starterFiles[UI_MANIFEST_PATH];
  if (ui === undefined) throw new RevitionCliError({ code: 'STARTER_HAS_NO_UI', message: 'The platform starter for custom_ui has no ui/manifest.json.' }, EXIT.general);
  return { [UI_MANIFEST_PATH]: ui };
}

interface JsonSchema {
  readonly properties?: Readonly<Record<string, { readonly items?: { readonly enum?: readonly string[] } }>>;
}

/** A skeleton valid against the platform's published EvalSuite schema: one dimension (the first listed), one case. */
export function renderEvalSuite(name: string, capability: string | null): Files {
  const path = `evals/${name}.json`;
  if (!EVAL_SUITE_PATH.test(path)) throw usageError('INVALID_NAME', `An eval suite name is lowercase letters, digits and dashes: ${name}.`);
  const schema = COMPONENT_SCHEMAS['EvalSuite'] as JsonSchema | undefined;
  const dims = schema?.properties?.['dimensions']?.items?.enum ?? [];
  if (dims.length === 0) throw new RevitionCliError({ code: 'CONTRACT_MISSING_EVALSUITE', message: 'This CLI build has no EvalSuite schema in its contract.' }, EXIT.general);
  const suite = { description: '', ...(capability === null ? {} : { capability }), dimensions: [dims[0]], cases: [{ id: 'case-1', input: {} }] };
  return { [path]: `${JSON.stringify(suite, null, 2)}\n` };
}

/** tests.json with one more case (`{name, input: {}, expect: {}}`); refuses a duplicate name or a 21st case. */
export function withTestCase(testsText: string | undefined, caseName: string): string {
  const cases = testsText === undefined ? [] : (JSON.parse(testsText) as Array<{ name: string }>);
  if (cases.some((c) => c.name === caseName)) throw usageError('TEST_EXISTS', `A test named "${caseName}" already exists.`);
  if (cases.length >= 20) throw usageError('TEST_LIMIT', 'A capability has at most 20 tests.');
  return `${JSON.stringify([...cases, { name: caseName, input: {}, expect: {} }], null, 2)}\n`;
}
