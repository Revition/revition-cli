// T1.1.1 AC6 (startup budget) - writes <package root>/oclif.manifest.json: the cached command metadata oclif reads
// instead of importing every command module for help and routing. Built with oclif's own Plugin loader, the same data
// `oclif manifest` writes. Run after `tsc` (the manifest is computed from dist/commands).
//   node scripts/oclif-manifest.mjs [package root]    (default: this package)
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Plugin } from '@oclif/core';

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const plugin = new Plugin({ root, type: 'core', ignoreManifest: true, respectNoCacheDefault: true, isRoot: true });
await plugin.load();
writeFileSync(join(root, 'oclif.manifest.json'), `${JSON.stringify(plugin.manifest, null, 2)}\n`);
console.log(`oclif.manifest.json: ${Object.keys(plugin.manifest.commands).length} commands (${root})`);
