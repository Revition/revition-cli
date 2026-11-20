import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';

/**
 * T3.2.1 AC1 - every `--json` document a test captures from the real CLI is checked against the command's PUBLISHED
 * schema (`schemas/cli/<id>.v1.json`, generated from the command's type). A document that does not validate fails the
 * test that produced it. With REVITION_SCHEMA_COVERAGE set, each validated command id is appended to that file.
 */
const SCHEMA_DIR = fileURLToPath(new URL('../../../../schemas/cli/', import.meta.url));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const compiled = new Map<string, ReturnType<typeof ajv.compile>>();

export function assertConformsToSchema(stdout: string): void {
  let doc: { command?: unknown; ok?: unknown };
  try {
    doc = JSON.parse(stdout) as { command?: unknown; ok?: unknown };
  } catch {
    return;
  }
  if (typeof doc.command !== 'string' || doc.ok !== true) return;
  const file = `${SCHEMA_DIR}${doc.command.replace(/:/g, '.')}.v1.json`;
  if (!existsSync(file)) throw new Error(`no published schema for ${doc.command} (${file})`);
  let validate = compiled.get(file);
  if (validate === undefined) {
    validate = ajv.compile(JSON.parse(readFileSync(file, 'utf8')) as object);
    compiled.set(file, validate);
  }
  if (!validate(doc)) {
    throw new Error(`${doc.command} --json does not match its published schema: ${ajv.errorsText(validate.errors)}`);
  }
  const coverage = process.env['REVITION_SCHEMA_COVERAGE'];
  if (coverage !== undefined && coverage !== '') appendFileSync(coverage, `${doc.command}\n`);
}
