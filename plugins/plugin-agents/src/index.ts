// @revition/plugin-agents - agents as code (REVITION-CLI-PLAN Phase 3, Set 1). Commands are discovered from
// dist/commands; the definition format and its local validation are exported for tests and later plugins.
export { canonical, definitionFromDraft, definitionText, diffBySection, draftBody, parseDefinitionText, type AgentDefinition } from './format.js';
export { secretFindings, validateLocal } from './validate.js';
