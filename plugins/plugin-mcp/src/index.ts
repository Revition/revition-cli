// @revition/plugin-mcp - `revition mcp serve` (REVITION-CLI-PLAN Phase 3, Set 2, T3.2.2). Commands are discovered from
// dist/commands; the registry, quote guard and server are exported for tests.
export { argsKey, PAID_QUOTE_SPECS, QuoteGuard, QuoteRefused, type QuoteDeps } from './quote-guard.js';
export { MCP_PROTOCOL_VERSION, McpServer, QUOTE_TOOL, RPC, serveStdio, type CliRun, type ServerDeps } from './server.js';
export { BASE_FLAGS, buildTools, exclusionReason, LOCAL_COMMANDS, toolArgv, toolName, toolSpec, type LoadedCommand, type ToolSpec } from './tool-registry.js';
