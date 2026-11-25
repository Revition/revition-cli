// Test reference (startup-path.test.ts): the CLI exactly as it ran before the startup bundle, so its output can be
// compared with bin/run's: the unbundled @oclif/core execute entry on bin/run's own directory, with the help class
// package.json named before (the compiled dist/help.js, not the bundle's).
const { Config } = await import('@oclif/core/config');
const { execute } = await import('@oclif/core/execute');
const config = await Config.load(new URL('../../bin/run', import.meta.url).href);
config.pjson.oclif.helpClass = './dist/help.js';
await execute({ loadOptions: config });
