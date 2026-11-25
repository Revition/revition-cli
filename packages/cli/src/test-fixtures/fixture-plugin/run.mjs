#!/usr/bin/env node
// Runs the fixture plugin as its own CLI root (the same oclif execute the real bin uses), args from argv.
import { execute } from '@oclif/core';

await execute({ dir: new URL('./package.json', import.meta.url).href, args: process.argv.slice(2) });
