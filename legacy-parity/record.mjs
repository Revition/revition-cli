// Records the "before" requests: run from the PLATFORM monorepo with a TS loader, pointing at its
// packages/revition-cli/src/commands.ts. Usage: node --import tsx record.mjs <path-to-commands.ts> <out.json>
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { runAllCommands } from './parity-harness.mjs';

const [commandsPath, outPath] = process.argv.slice(2);
const { runCli } = await import(pathToFileURL(resolve(commandsPath)).href);
const recorded = await runAllCommands(runCli);
writeFileSync(outPath, `${JSON.stringify(recorded, null, 2)}\n`);
process.stdout.write(`recorded ${Object.keys(recorded).length} commands to ${outPath}\n`);
