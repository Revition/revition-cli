// T1.1.1 AC6: the startup bundle, dist/bundle/startup.js (entry src/startup-bundle.ts: oclif's execute + the help
// class). Built as oclif's plugin-test-esbuild bin/bundle.js builds its bundle (esbuild, ESM, platform node, the CJS
// shims injected, tree shaking). Run after tsc (`pnpm build`); the npm package and the standalone executable ship it
// in dist/. Usage: node scripts/bundle-startup.mjs
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  absWorkingDir: PKG,
  bundle: true,
  entryPoints: { startup: './src/startup-bundle.ts' },
  // oclif requires typescript lazily, only to read a development tsconfig (lib/util/read-tsconfig.js:37), and goes on
  // without it; bundled it would be 9.9 MB of the 10.5 MB. External, it resolves at run time exactly as unbundled.
  external: ['typescript'],
  format: 'esm',
  inject: ['./scripts/cjs-shims.mjs'],
  // The bundled packages' licence comments are kept, at the end of the file.
  legalComments: 'eof',
  logLevel: 'warning',
  outdir: './dist/bundle',
  platform: 'node',
  target: 'node22',
  treeShaking: true,
});
