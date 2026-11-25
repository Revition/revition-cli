// T1.1.1 AC6: the startup bundle, dist/bundle/startup.js (entry src/startup-bundle.ts: oclif's execute + the help
// class). Built as oclif's plugin-test-esbuild bin/bundle.js builds its bundle (esbuild, ESM, platform node, the CJS
// shims injected, tree shaking). Run after tsc (`pnpm build`); the npm package and the standalone executable ship it
// in dist/. Usage: node scripts/bundle-startup.mjs
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * oclif's Config.load sets `this.shell = getShell()` eagerly (lib/config/config.js:307). On Windows with no SHELL in
 * the environment (cmd, PowerShell) getShell runs `powershell.exe ... Get-CimInstance` synchronously to name the
 * parent shell (lib/util/os.js:51): ~250 ms of every run (windows-latest --help 317 ms bundled, --version 42 ms).
 * Root help never reads `config.shell` (its readers: command help examples, help/command.js:126, and
 * config.versionDetails, config.js:195). In the bundle the property is computed on first read instead, with the same
 * value. The build fails if oclif's line is not found exactly once (an oclif upgrade must re-check this).
 */
export const EAGER_SHELL = 'this.shell = (0, os_1.getShell)();';
export const LAZY_SHELL =
  'Object.defineProperty(this, "shell", { configurable: true, enumerable: true, ' +
  'get() { const value = (0, os_1.getShell)(); Object.defineProperty(this, "shell", { configurable: true, enumerable: true, writable: true, value }); return value; }, ' +
  'set(value) { Object.defineProperty(this, "shell", { configurable: true, enumerable: true, writable: true, value }); } });';

const lazyShell = {
  name: 'oclif-lazy-shell',
  setup(b) {
    b.onLoad({ filter: /[\\/]@oclif[\\/]core[\\/]lib[\\/]config[\\/]config\.js$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      if (source.split(EAGER_SHELL).length !== 2) throw new Error(`${args.path}: expected "${EAGER_SHELL}" exactly once`);
      return { contents: source.replace(EAGER_SHELL, LAZY_SHELL), loader: 'js' };
    });
  },
};

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
  plugins: [lazyShell],
  target: 'node22',
  treeShaking: true,
});
