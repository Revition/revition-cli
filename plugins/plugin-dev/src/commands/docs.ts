import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Args, Flags } from '@oclif/core';
import {
  atomicWriteFile,
  defaultCliPaths,
  EXIT,
  RevitionCliError,
  RevitionCommand,
  type CommandContext,
  type CommandMeta,
  type HumanView,
} from '@revition/cli-core';

import { devApi } from '../api.js';

/**
 * T2.4.4 - `revition docs sdk|ui`: the platform's SDK / UI reference (GET /dev/docs/sdk|ui), rendered in the terminal
 * (the pipeline pages long output). Every fetch refreshes a local copy; offline, the last copy is rendered and said
 * to be one (AC1).
 */
export const DOC_KINDS = ['sdk', 'ui'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

interface SdkReference {
  readonly version: string;
  readonly namespaces: readonly { readonly name: string; readonly calls: readonly { readonly call: string; readonly signature: string; readonly doc: string | null; readonly permissions: readonly string[] }[] }[];
  readonly types: readonly { readonly name: string; readonly fields: readonly { readonly name: string; readonly type: string; readonly doc: string | null }[] }[];
}

interface UiReference {
  readonly designSystemVersion: string;
  readonly components: readonly { readonly name: string; readonly props: readonly string[]; readonly accessibleName: readonly string[]; readonly children: string }[];
  readonly surfaces: readonly string[];
  readonly embedSurfaces: readonly string[];
  readonly platformOwned: readonly string[];
}

export const docsCacheFile = (kind: DocKind): string => join(defaultCliPaths().cacheDir, `docs-${kind}.json`);

/** The reference as terminal lines. PURE. */
export function docLines(kind: DocKind, body: unknown): string[] {
  if (kind === 'sdk') {
    const r = body as SdkReference;
    const calls = r.namespaces.flatMap((n) => [
      `${n.name}`,
      ...n.calls.flatMap((c) => [
        `  ${c.signature}${c.permissions.length === 0 ? '' : `  [needs ${c.permissions.join(', ')}]`}`,
        ...(c.doc === null ? [] : [`    ${c.doc}`]),
      ]),
    ]);
    const types = r.types.flatMap((t) => [`type ${t.name}`, ...t.fields.map((f) => `  ${f.name}: ${f.type}${f.doc === null ? '' : `  ${f.doc}`}`)]);
    return [`Extension SDK ${r.version}`, ...calls, ...types];
  }
  const u = body as UiReference;
  return [
    `Experience SDK (design system ${u.designSystemVersion})`,
    ...u.components.flatMap((c) => [
      `${c.name}`,
      `  props: ${c.props.join(', ') || '-'}`,
      ...(c.accessibleName.length === 0 ? [] : [`  accessible name: ${c.accessibleName.join(' or ')}`]),
      `  children: ${c.children}`,
    ]),
    `surfaces: ${u.surfaces.join(', ')}`,
    `embed surfaces: ${u.embedSurfaces.join(', ')}`,
    `platform-owned: ${u.platformOwned.join(', ')}`,
  ];
}

/** `--search`: the lines containing the term, each with the heading it sits under. PURE. */
export function searchLines(lines: readonly string[], term: string | null): string[] {
  if (term === null) return [...lines];
  const t = term.toLowerCase();
  const out: string[] = [];
  let heading = '';
  for (const l of lines.slice(1)) {
    if (!l.startsWith(' ')) heading = l;
    if (l.toLowerCase().includes(t)) {
      if (l !== heading && out.at(-1) !== heading && !out.includes(heading)) out.push(heading);
      out.push(l);
    }
  }
  return out;
}

interface Out {
  readonly kind: DocKind;
  readonly fromCache: boolean;
  readonly search: string | null;
  readonly reference: unknown;
}

export default class Docs extends RevitionCommand<Out> {
  static override summary = 'The platform SDK or UI reference in the terminal (offline: the last copy).';
  static override examples = ['revition docs sdk', 'revition docs sdk --search knowledge', 'revition docs ui --json'];
  static meta: CommandMeta = {
    id: 'docs',
    summary: Docs.summary,
    examples: Docs.examples,
    requiredScopes: ['cli:read'],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.docs.v1',
    stability: 'stable',
  };
  static override args = { kind: Args.string({ options: [...DOC_KINDS], required: true, description: 'sdk or ui.' }) };
  static override flags = { search: Flags.string({ description: 'Only the entries containing this text.' }) };

  protected async run2(ctx: CommandContext): Promise<Out> {
    const kind = ctx.args['kind'] as DocKind;
    const search = typeof ctx.commandFlags['search'] === 'string' ? ctx.commandFlags['search'] : null;
    try {
      const api = await devApi(ctx);
      const reference = (await api.request({ method: 'GET', path: `/dev/docs/${kind}` })).body;
      await atomicWriteFile(docsCacheFile(kind), JSON.stringify(reference));
      return { kind, fromCache: false, search, reference };
    } catch (e) {
      if (!(e instanceof RevitionCliError) || e.exitCode !== EXIT.network) throw e;
      try {
        const reference = JSON.parse(readFileSync(docsCacheFile(kind), 'utf8')) as unknown;
        ctx.warn(`Offline: the saved copy of the ${kind} reference.`);
        return { kind, fromCache: true, search, reference };
      } catch {
        throw new RevitionCliError({ code: 'OFFLINE_NO_DOCS', message: `Offline, and no saved copy of the ${kind} reference yet.`, hint: `Connect once and run \`revition docs ${kind}\`.` }, EXIT.network);
      }
    }
  }

  protected override human(o: Out): HumanView {
    const lines = searchLines(docLines(o.kind, o.reference), o.search);
    return { text: lines.length === 0 ? `Nothing in the ${o.kind} reference matches "${o.search ?? ''}".\n` : `${lines.join('\n')}\n` };
  }
}
