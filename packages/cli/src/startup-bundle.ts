/**
 * T1.1.1 AC6 (startup <= 300 ms on the 3 OS): the entry of the startup bundle (scripts/bundle-startup.mjs ->
 * dist/bundle/startup.js). The root help run (`revition` / `revition --help`, bin/run) starts oclif from this ONE file
 * instead of the ~110 module files of @oclif/core and its dependencies: on Windows each module file costs a resolve and
 * an open (PR #11: --help 537 ms unbundled). The help class is resolved from here for every run (package.json
 * oclif.helpClass, the {target, identifier} form of oclif's plugin-test-esbuild). A command run keeps the unbundled
 * oclif: its command classes import @oclif/core, and one run never mixes two copies of it.
 */
export { execute } from '@oclif/core/execute';
export { default as RevitionHelp } from './help.js';
