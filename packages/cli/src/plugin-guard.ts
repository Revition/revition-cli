/**
 * T1.1.1 - the plugin host's own guard: two plugins defining the same command id - the core wins and the plugin is
 * refused. PURE.
 *
 * Third-party INSTALLS (T1.1.1 AC4, CLI:765) are refused by `revition plugins install` itself since Phase 4 (T4.2.1-T4.2.3):
 * a plugin that is not in the Revition registry, not allowed by the workspace, unsigned, or from an unregistered
 * publisher is refused with exit 4 and the plugin policy (ADR 0007, `PLUGIN_POLICY_URL` in the core).
 */
export interface CommandOwner {
  readonly id: string;
  readonly pluginName: string;
}

/**
 * Command ids defined by a non-core plugin that the core also defines: the core keeps them, the plugin is refused.
 * Returns one message per collision.
 */
export function duplicateCommandRefusals(commands: readonly CommandOwner[], corePlugin: string): string[] {
  const core = new Set(commands.filter((c) => c.pluginName === corePlugin).map((c) => c.id));
  return commands
    .filter((c) => c.pluginName !== corePlugin && core.has(c.id))
    .map((c) => `Refused plugin ${c.pluginName}: it redefines the core command "${c.id.replace(/:/g, ' ')}".`);
}
