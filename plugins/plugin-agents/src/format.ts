import { parse, stringify } from 'yaml';

/**
 * T3.1.1 - the agent definition file (`agents/<slug>.agent.yaml`, schemaVersion 1): the draft body the platform's
 * PUT /deployments/{id}/draft accepts (`draftBodySchema`: config + sections), wrapped with the agent's identity. The
 * JSON Schema is the platform's own, generated from that Zod schema (apps/api scripts/openapi/generate-agent-schema.ts)
 * and pinned here byte for byte (`schema/agent-definition.v1.json`); this module never restates its fields.
 * Secrets are never inline: tools, skills, knowledge and variables are references the server resolves.
 */
export interface AgentDefinition {
  readonly schemaVersion: 1;
  readonly agent: { readonly id: string | null; readonly name: string };
  readonly config: { readonly config: Readonly<Record<string, unknown>>; readonly sections: Readonly<Record<string, unknown>> };
}

/** The draft as GET /deployments/{id}/draft answers it (the fields a definition is made of). */
export interface DraftView {
  readonly version: number;
  readonly config: Readonly<Record<string, unknown>>;
  readonly sections: Readonly<Record<string, unknown>>;
}

export const DEFINITION_SUFFIX = '.agent.yaml';

/** A file's text -> the parsed document (YAML; JSON is valid YAML). Throws with the parser's message. PURE. */
export function parseDefinitionText(text: string): unknown {
  return parse(text, { uniqueKeys: true, prettyErrors: true });
}

/** The file text: YAML, multi-line strings as literal blocks, keys in the order the definition holds them. PURE. */
export function definitionText(def: AgentDefinition): string {
  return stringify(def, { lineWidth: 0, blockQuote: 'literal' });
}

/** A pulled draft as a definition (references only: the server never returns a secret value). PURE. */
export function definitionFromDraft(agent: { readonly id: string; readonly name: string }, draft: DraftView): AgentDefinition {
  return { schemaVersion: 1, agent: { id: agent.id, name: agent.name }, config: { config: draft.config, sections: draft.sections } };
}

/** The body PUT .../draft takes for a definition, with the version it was pulled at. PURE. */
export function draftBody(def: AgentDefinition, baseVersion: number | null): Record<string, unknown> {
  return { config: def.config.config, sections: def.config.sections, ...(baseVersion === null ? {} : { baseVersion }) };
}

/** Key-order-independent JSON (the comparison the "no changes" check and the per-section diff use). PURE. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export interface SectionDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
}

/**
 * The semantic diff by section between two definitions' bodies: each config field (`config.<field>`) and each section
 * (`sections.<name>`) is one unit; an edit inside one shows as that unit. PURE.
 */
export function diffBySection(from: AgentDefinition['config'], to: AgentDefinition['config']): SectionDiff {
  const units = (c: AgentDefinition['config']): Map<string, string> =>
    new Map([
      ...Object.entries(c.config).map(([k, v]) => [`config.${k}`, canonical(v)] as const),
      ...Object.entries(c.sections).map(([k, v]) => [`sections.${k}`, canonical(v)] as const),
    ]);
  const a = units(from);
  const b = units(to);
  const sorted = (xs: Iterable<string>): string[] => [...xs].sort();
  return {
    added: sorted([...b.keys()].filter((k) => !a.has(k))),
    removed: sorted([...a.keys()].filter((k) => !b.has(k))),
    changed: sorted([...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k))),
  };
}

export const isEmptyDiff = (d: SectionDiff): boolean => d.added.length + d.removed.length + d.changed.length === 0;
