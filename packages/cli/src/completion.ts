/**
 * T1.1.6 - completion scripts for bash, zsh, fish and PowerShell, generated from the command manifest (so every
 * command, topic and flag the CLI has completes, and nothing else). PURE.
 */
export const SHELLS = ['bash', 'zsh', 'fish', 'powershell'] as const;
export type Shell = (typeof SHELLS)[number];

export interface CompletionCommand {
  /** Space-separated words, e.g. `config get`. */
  readonly words: string;
  readonly summary: string;
  readonly flags: readonly string[];
}

/** For each command path prefix, the words that may follow it ('' = top level). */
function tree(commands: readonly CompletionCommand[]): Map<string, Set<string>> {
  const next = new Map<string, Set<string>>();
  for (const c of commands) {
    const parts = c.words.split(' ');
    for (let i = 0; i < parts.length; i++) {
      const prefix = parts.slice(0, i).join(' ');
      const set = next.get(prefix) ?? new Set<string>();
      set.add(parts[i] ?? '');
      next.set(prefix, set);
    }
    const set = next.get(c.words) ?? new Set<string>();
    for (const f of c.flags) set.add(`--${f}`);
    next.set(c.words, set);
  }
  return next;
}

const q = (s: string): string => s.replace(/'/g, "'\\''");

export function completionScript(shell: Shell, bin: string, commands: readonly CompletionCommand[]): string {
  const t = tree(commands);
  const entries = [...t.entries()].sort(([a], [b]) => a.localeCompare(b));
  const fn = `_${bin.replace(/[^a-z0-9]/gi, '_')}_complete`;
  if (shell === 'bash') {
    const cases = entries.map(([k, v]) => `    '${q(k)}') opts='${q([...v].sort().join(' '))}' ;;`).join('\n');
    return [
      `# ${bin} completion for bash. Install: ${bin} autocomplete bash > ~/.${bin}-completion.bash && echo 'source ~/.${bin}-completion.bash' >> ~/.bashrc`,
      `${fn}() {`,
      '  local cur words key opts',
      '  cur="${COMP_WORDS[COMP_CWORD]}"',
      '  words=("${COMP_WORDS[@]:1:COMP_CWORD-1}")',
      '  key="${words[*]}"',
      // Longest known prefix wins: drop the last word until the key is in the table (or empty, then nothing).
      '  opts=""',
      '  while true; do',
      '    case "$key" in',
      cases,
      '    *)',
      '      if [ -z "$key" ]; then break; fi',
      '      case "$key" in *" "*) key="${key% *}" ;; *) key="" ;; esac',
      '      continue ;;',
      '    esac',
      '    break',
      '  done',
      '  COMPREPLY=($(compgen -W "$opts" -- "$cur"))',
      '}',
      `complete -F ${fn} ${bin}`,
      '',
    ].join('\n');
  }
  if (shell === 'zsh') {
    const cases = entries.map(([k, v]) => `    '${q(k)}') opts=(${[...v].sort().map((w) => `'${q(w)}'`).join(' ')}) ;;`).join('\n');
    return [
      `#compdef ${bin}`,
      `# ${bin} completion for zsh. Install: ${bin} autocomplete zsh > "\${fpath[1]}/_${bin}" && compinit`,
      `${fn}() {`,
      '  local key="${words[2,CURRENT-1]}"',
      '  local -a opts',
      '  case "$key" in',
      cases,
      '    *) opts=() ;;',
      '  esac',
      '  compadd -- $opts',
      '}',
      `compdef ${fn} ${bin}`,
      '',
    ].join('\n');
  }
  if (shell === 'fish') {
    const lines = [`# ${bin} completion for fish. Install: ${bin} autocomplete fish > ~/.config/fish/completions/${bin}.fish`];
    lines.push(`complete -c ${bin} -f`);
    for (const [k, v] of entries) {
      const condition = k === '' ? `__fish_use_subcommand` : `__fish_seen_subcommand_from ${k.split(' ').pop() ?? ''}`;
      for (const w of [...v].sort()) {
        if (w.startsWith('--')) lines.push(`complete -c ${bin} -n '${condition}' -l '${q(w.slice(2))}'`);
        else lines.push(`complete -c ${bin} -n '${condition}' -a '${q(w)}'`);
      }
    }
    return `${lines.join('\n')}\n`;
  }
  const table = entries.map(([k, v]) => `  '${k.replace(/'/g, "''")}' = @(${[...v].sort().map((w) => `'${w.replace(/'/g, "''")}'`).join(', ')})`).join('\n');
  return [
    `# ${bin} completion for PowerShell. Install: ${bin} autocomplete powershell >> $PROFILE`,
    `$${fn}Tree = @{`,
    table,
    '}',
    `Register-ArgumentCompleter -Native -CommandName ${bin} -ScriptBlock {`,
    '  param($wordToComplete, $commandAst, $cursorPosition)',
    '  $words = @($commandAst.CommandElements | Select-Object -Skip 1 | ForEach-Object { $_.ToString() })',
    "  if ($wordToComplete -ne '') { $words = @($words | Select-Object -SkipLast 1) }",
    "  $key = ($words -join ' ')",
    `  $opts = $${fn}Tree[$key]`,
    '  if ($null -eq $opts) { $opts = @() }',
    '  $opts | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {',
    "    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)",
    '  }',
    '}',
    '',
  ].join('\n');
}
