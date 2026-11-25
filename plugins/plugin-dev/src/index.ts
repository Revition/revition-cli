// @revition/plugin-dev - the developer workflow (REVITION-CLI-PLAN Phase 2). Commands are discovered from dist/commands;
// the helpers below are exported for the plugin's own tests and for later plugins.
export { unsafePath, writeStarter, type ProjectFiles } from './project/write-starter.js';
export { ensureGitignore, GITIGNORE_LINES, readLink, writeLink } from './project/project-link.js';
