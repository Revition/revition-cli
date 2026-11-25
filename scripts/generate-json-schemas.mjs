// T3.2.1 - the published `--json` schemas: one per command, `schemas/cli/<command id>.v1.json`, generated from the
// command's own TypeScript type (the `T` of `RevitionCommand<T>`, through the TypeScript compiler's type checker) and
// wrapped in the `--json` envelope. Never hand-written.
//   node scripts/generate-json-schemas.mjs            write schemas/cli/*.json
//   node scripts/generate-json-schemas.mjs --check    exit 1 when a committed schema differs from the generated one
//   node scripts/generate-json-schemas.mjs --semver   exit 1 when a change is breaking (docs/policy/versioning.md rule
//                                                     6) and the CLI version was not bumped for it (major; minor < 1.0)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SCHEMA_DIR = join(ROOT, 'schemas', 'cli');
// The core and every plugin the CLI registers (packages/cli/package.json oclif.plugins: @revition/<dir>).
const PACKAGES = [
  'packages/cli',
  ...JSON.parse(readFileSync(join(ROOT, 'packages/cli/package.json'), 'utf8')).oclif.plugins.map((name) => `plugins/${name.replace('@revition/', '')}`),
];

export const schemaFileName = (commandId) => `${commandId.replace(/:/g, '.')}.v1.json`;

/** The data schema of one TypeScript type (objects open: consumers ignore fields they do not know). */
function typeToSchema(checker, type, seen = new Set(), depth = 0) {
  if (depth > 14) return {};
  const f = type.flags;
  if (f & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return {};
  if (f & ts.TypeFlags.StringLiteral) return { const: type.value };
  if (f & ts.TypeFlags.NumberLiteral) return { const: type.value };
  if (f & ts.TypeFlags.BooleanLiteral) return { const: checker.typeToString(type) === 'true' };
  if (f & ts.TypeFlags.Boolean) return { type: 'boolean' };
  if (f & (ts.TypeFlags.String | ts.TypeFlags.TemplateLiteral)) return { type: 'string' };
  if (f & ts.TypeFlags.Number) return { type: 'number' };
  if (f & ts.TypeFlags.Null) return { type: 'null' };
  if (f & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) return { not: {} };
  if (type.isUnion()) {
    const parts = type.types.filter((t) => !(t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)));
    if (parts.length === 1) return typeToSchema(checker, parts[0], seen, depth + 1);
    const nonBoolLits = parts.filter((t) => !(t.flags & ts.TypeFlags.BooleanLiteral));
    const hasBool = nonBoolLits.length < parts.length;
    if (nonBoolLits.every((t) => t.flags & ts.TypeFlags.StringLiteral) && nonBoolLits.length > 0 && !hasBool) {
      return { enum: nonBoolLits.map((t) => t.value).sort() };
    }
    const anyOf = nonBoolLits.map((t) => typeToSchema(checker, t, seen, depth + 1));
    if (hasBool) anyOf.push({ type: 'boolean' });
    return { anyOf };
  }
  if (checker.isTupleType(type)) {
    return { type: 'array', items: { anyOf: checker.getTypeArguments(type).map((t) => typeToSchema(checker, t, seen, depth + 1)) } };
  }
  if (checker.isArrayType(type)) {
    const [item] = checker.getTypeArguments(type);
    return { type: 'array', items: item === undefined ? {} : typeToSchema(checker, item, seen, depth + 1) };
  }
  if (f & ts.TypeFlags.Object) {
    if (type.getCallSignatures().length > 0) return {};
    if (seen.has(type)) return { type: 'object' };
    const next = new Set(seen).add(type);
    const properties = {};
    const required = [];
    for (const prop of checker.getPropertiesOfType(type)) {
      const pt = checker.getTypeOfSymbol(prop);
      if (pt.getCallSignatures().length > 0) continue;
      const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0 || (pt.isUnion() && pt.types.some((t) => t.flags & ts.TypeFlags.Undefined));
      properties[prop.name] = typeToSchema(checker, pt, next, depth + 1);
      if (!optional) required.push(prop.name);
    }
    const index = checker.getIndexInfoOfType(type, ts.IndexKind.String);
    return {
      type: 'object',
      properties,
      required: required.sort(),
      additionalProperties: index === undefined ? true : typeToSchema(checker, index.type, next, depth + 1),
    };
  }
  return {};
}

/** The `--json` envelope around a command's data (packages/core/src/output/envelope.ts). */
function envelopeSchema(commandId, jsonSchemaId, data, cliVersion) {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://developer.revition.com/cli/schemas/${schemaFileName(commandId)}`,
    title: `revition ${commandId.replace(/:/g, ' ')} --json`,
    'x-schema-id': jsonSchemaId,
    'x-cli-version': cliVersion,
    type: 'object',
    required: ['schemaVersion', 'command', 'ok', 'data', 'error', 'warnings', 'meta'],
    properties: {
      schemaVersion: { const: 1 },
      command: { const: commandId },
      ok: { type: 'boolean' },
      data: { anyOf: [data, { type: 'null' }] },
      error: { anyOf: [{ type: 'null' }, { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' } } }] },
      warnings: { type: 'array', items: { type: 'string' } },
      meta: { type: 'object', required: ['cliVersion'], properties: { cliVersion: { type: 'string' } } },
    },
  };
}

/** A meta field's string value: a literal, or a constant the checker resolves to a string literal type. */
function stringOf(checker, expr) {
  if (expr === undefined) return null;
  if (ts.isStringLiteral(expr)) return expr.text;
  const t = checker.getTypeAtLocation(expr);
  return t.isStringLiteral() ? t.value : null;
}

function staticMeta(checker, node) {
  for (const m of node.members) {
    if (ts.isPropertyDeclaration(m) && m.name.getText() === 'meta' && m.initializer && ts.isObjectLiteralExpression(m.initializer)) {
      const get = (k) => m.initializer.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText() === k)?.initializer;
      return { id: stringOf(checker, get('id')), jsonSchemaId: stringOf(checker, get('jsonSchemaId')) };
    }
  }
  return { id: null, jsonSchemaId: null };
}

/** Every command's envelope schema, generated from the sources. */
export function generateSchemas(root = ROOT) {
  const cliVersion = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8')).version;
  const out = new Map();
  for (const pkg of PACKAGES) {
    const cfgPath = join(root, pkg, 'tsconfig.json');
    if (!existsSync(cfgPath)) continue;
    const cfg = ts.getParsedCommandLineOfConfigFile(cfgPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined });
    const program = ts.createProgram(cfg.fileNames, cfg.options);
    const checker = program.getTypeChecker();
    // TypeScript names files with forward slashes on every OS; path.join uses backslashes on Windows.
    const commandsDir = join(root, pkg, 'src', 'commands').replace(/\\/g, '/');
    for (const sf of program.getSourceFiles()) {
      if (!sf.fileName.replace(/\\/g, '/').startsWith(commandsDir) || sf.fileName.endsWith('.test.ts')) continue;
      ts.forEachChild(sf, (node) => {
        if (!ts.isClassDeclaration(node) || !node.heritageClauses) return;
        const ext = node.heritageClauses.flatMap((h) => h.types).find((t) => t.expression.getText() === 'RevitionCommand');
        const arg = ext?.typeArguments?.[0];
        const meta = staticMeta(checker, node);
        if (arg === undefined || meta.id === null || meta.jsonSchemaId === null) return;
        out.set(meta.id, envelopeSchema(meta.id, meta.jsonSchemaId, typeToSchema(checker, checker.getTypeFromTypeNode(arg)), cliVersion));
      });
    }
  }
  return out;
}

export const renderSchema = (s) => `${JSON.stringify(s, null, 2)}\n`;

/** The breaking changes from one schema to the next (versioning.md rule 6), as paths. PURE. */
export function breakingChanges(before, after, path = '') {
  if (before === undefined || after === undefined) return [];
  const out = [];
  const typeOf = (s) => s.type ?? (s.const !== undefined ? typeof s.const : s.enum !== undefined ? 'string' : s.anyOf ? 'anyOf' : undefined);
  const nullable = (s) => s.type === 'null' || (Array.isArray(s.anyOf) && s.anyOf.some((x) => x.type === 'null'));
  if (typeOf(before) !== undefined && typeOf(after) !== undefined && typeOf(before) !== typeOf(after)) out.push(`${path || '/'}: type changed`);
  if (!nullable(before) && nullable(after)) out.push(`${path || '/'}: became nullable`);
  const bp = before.properties ?? {};
  const ap = after.properties ?? {};
  const bReq = new Set(before.required ?? []);
  const aReq = new Set(after.required ?? []);
  for (const k of Object.keys(bp)) {
    if (!(k in ap)) out.push(`${path}/${k}: removed`);
    else {
      if (bReq.has(k) && !aReq.has(k)) out.push(`${path}/${k}: no longer always present`);
      out.push(...breakingChanges(bp[k], ap[k], `${path}/${k}`));
    }
  }
  if (before.items && after.items) out.push(...breakingChanges(before.items, after.items, `${path}[]`));
  if (Array.isArray(before.anyOf) && Array.isArray(after.anyOf) && before.anyOf.length === after.anyOf.length) {
    before.anyOf.forEach((b, i) => out.push(...breakingChanges(b, after.anyOf[i], `${path}|${i}`)));
  }
  return out;
}

/** Whether `next` is the release a breaking change needs after `prev` (major; the minor before 1.0). PURE. */
export function bumpedForBreaking(prev, next) {
  const [pM, pm] = prev.split('.').map(Number);
  const [nM, nm] = next.split('.').map(Number);
  return pM === 0 && nM === 0 ? nm > pm : nM > pM;
}

function committed() {
  const out = new Map();
  if (!existsSync(SCHEMA_DIR)) return out;
  for (const f of readdirSync(SCHEMA_DIR).filter((n) => n.endsWith('.json'))) {
    const s = JSON.parse(readFileSync(join(SCHEMA_DIR, f), 'utf8'));
    out.set(s.properties.command.const, s);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const generated = generateSchemas();
  const mode = process.argv[2];
  if (mode === '--check' || mode === '--semver') {
    const old = committed();
    const problems = [];
    for (const [id, s] of generated) {
      const prev = old.get(id);
      if (mode === '--check' && (prev === undefined || renderSchema(prev) !== renderSchema({ ...s, 'x-cli-version': prev['x-cli-version'] }))) problems.push(`${schemaFileName(id)} is stale`);
      if (mode === '--semver' && prev !== undefined) {
        const breaking = breakingChanges(prev.properties.data.anyOf[0], s.properties.data.anyOf[0]);
        if (breaking.length > 0 && !bumpedForBreaking(prev['x-cli-version'], s['x-cli-version'])) {
          problems.push(`${id}: breaking --json change without a ${prev['x-cli-version'].startsWith('0.') ? 'minor' : 'major'} bump: ${breaking.join('; ')}`);
        }
      }
    }
    for (const id of old.keys()) if (!generated.has(id) && mode === '--semver') problems.push(`${id}: its schema was removed (a removed command is a major change)`);
    for (const p of problems) console.error(p);
    if (problems.length > 0) process.exit(1);
    console.log(`${generated.size} command schemas: ${mode === '--check' ? 'current' : 'no unversioned breaking change'}`);
  } else {
    mkdirSync(SCHEMA_DIR, { recursive: true });
    for (const [id, s] of generated) writeFileSync(join(SCHEMA_DIR, schemaFileName(id)), renderSchema(s));
    console.log(`wrote ${generated.size} schemas to ${SCHEMA_DIR}`);
  }
}
