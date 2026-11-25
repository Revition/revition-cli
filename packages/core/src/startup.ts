/**
 * `@revition/cli-core/startup` - the few helpers `revition --help` needs to decide which commands to list (T1.1.1 /
 * T1.4.3), without loading the whole core: T1.1.1 AC6 (REVITION-CLI-PLAN.md:755) `--help` starts in <= 300 ms. Each
 * name here is the SAME function the core index exports (re-exported, never copied).
 */
export { experimentalOptIn } from './command/stability.js';
export { defaultCliPaths } from './config/paths.js';
export { readFlagCache } from './flags/flag-cache.js';
