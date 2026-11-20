// @revition/plugin-assist - Revition Assist on this machine (REVITION-CLI-PLAN Phase 3, Set 3). T3.3.2: the local tool
// executor and its permission checks (the policy itself lives in @revition/cli-core permissions/).
export { pushBackup, undoLast, writeProjectFile } from './executor/backup.js';
export { applyUnifiedPatch, StalePatch, unifiedDiff } from './executor/diff.js';
export { LocalExecutor, type Approval, type ExecutorDeps, type ToolRequest, type ToolResult } from './executor/executor.js';
