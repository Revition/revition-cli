// T1.6.3 - the command reference, generated from the CLI's own command metadata (the same data oclif builds its manifest
// and `--help` from), so the docs can never drift from the binary.
//   node scripts/command-reference.mjs           writes <repo>/docs/reference/commands.md
//   node scripts/command-reference.mjs --check   exits 1 when the file differs from what the build would generate
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Config } from '@oclif/core';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REFERENCE = join(PKG, '..', '..', 'docs', 'reference', 'commands.md');

const visibleFlags = (flags, global) =>
  Object.values(flags ?? {})
    .filter((f) => !f.hidden && (f.helpGroup === 'GLOBAL') === global)
    .sort((a, b) => a.name.localeCompare(b.name));

/**
 * Prose from the command metadata, safe as Markdown: a placeholder such as `agents/<name>.agent.yaml` or
 * `@<exact version>` is shown as code, so a renderer never takes `<name>` for an HTML element (markdownlint MD033) and
 * the reader sees it as a value to fill in. Text already in backticks is left alone.
 */
export function prose(text) {
  return (text ?? '')
    .split(/(`[^`]*`)/u)
    .map((part) =>
      part.startsWith('`') ? part : part.replace(/([\w/@-]*<[^<>`\n]+>(?:[\w/-]|\.(?=\w))*)/gu, '`$1`')
    )
    .join('');
}

function flagLine(f) {
  const short = f.char === undefined ? '' : `-${f.char}, `;
  const value = f.type === 'option' ? (f.options === undefined ? ' <value>' : ` <${f.options.join('|')}>`) : '';
  const req = f.required === true ? ' (required)' : '';
  return `- \`${short}--${f.name}${value}\`${req}: ${prose(f.description)}`.trimEnd();
}

/** The reference text for a loaded oclif config. PURE given the commands. */
export function renderReference(commands, bin) {
  const visible = commands.filter((c) => !c.hidden).sort((a, b) => a.id.localeCompare(b.id));
  const lines = [
    '# Command reference',
    '',
    `Generated from the \`${bin}\` command metadata by \`packages/cli/scripts/command-reference.mjs\`. Do not edit by hand.`,
    '',
  ];
  for (const c of visible) {
    const name = c.id.replace(/:/g, ' ');
    lines.push(`## \`${bin} ${name}\``, '', prose(c.summary ?? (c.description ?? '').split('\n')[0]), '');
    const args = Object.values(c.args ?? {});
    if (args.length > 0) {
      lines.push('Arguments:', '', ...args.map((a) => `- \`${a.name}\`${a.required ? ' (required)' : ''}: ${prose(a.description)}`.trimEnd()), '');
    }
    const flags = visibleFlags(c.flags, false);
    if (flags.length > 0) lines.push('Flags:', '', ...flags.map(flagLine), '');
    if ((c.examples ?? []).length > 0) {
      lines.push('Examples:', '', '```sh', ...c.examples.map((e) => (typeof e === 'string' ? e : e.command)), '```', '');
    }
  }
  const any = visible.find((c) => visibleFlags(c.flags, true).length > 0);
  if (any !== undefined) lines.push('## Global flags', '', ...visibleFlags(any.flags, true).map(flagLine), '');
  return `${lines.join('\n').trimEnd()}\n`;
}

export async function generate() {
  const config = await Config.load(PKG);
  return renderReference(config.commands, config.bin);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = await generate();
  if (process.argv.includes('--check')) {
    let current;
    try {
      current = readFileSync(REFERENCE, 'utf8');
    } catch {
      current = '';
    }
    if (current !== text) {
      console.error('docs/reference/commands.md is out of date: run `pnpm --filter @revition/cli reference`');
      process.exit(1);
    }
    console.log('command reference: up to date');
  } else {
    mkdirSync(dirname(REFERENCE), { recursive: true });
    writeFileSync(REFERENCE, text);
    console.log(`wrote ${REFERENCE}`);
  }
}
