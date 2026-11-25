// Injected into the startup bundle (scripts/bundle-startup.mjs), as in oclif's plugin-test-esbuild bin/cjs-shims.js:
// @oclif/core is CommonJS and calls require / __dirname / __filename, which an ESM bundle does not define.
import { createRequire } from 'node:module';
import path from 'node:path';
import url from 'node:url';

globalThis.require = createRequire(import.meta.url);
globalThis.__filename = url.fileURLToPath(import.meta.url);
globalThis.__dirname = path.dirname(globalThis.__filename);
