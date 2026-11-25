// Test child (startup-path.test.ts): renders the help of the root, every topic and every command (the CLI and its
// plugins, as oclif loads them) twice, with the help class from the startup bundle (what package.json oclif.helpClass
// now names) and with the compiled dist/help.js (what it named before the bundle), and prints one JSON line:
// { cases, mismatches: [{ argv, bundled, unbundled }] }. Help output goes through console.log (oclif ux.stdout).
import { Config } from '@oclif/core';

const BIN = new URL('../../bin/run', import.meta.url).href;
const { RevitionHelp: Bundled } = await import(new URL('../../dist/bundle/startup.js', import.meta.url).href);
const { default: Unbundled } = await import(new URL('../../dist/help.js', import.meta.url).href);

const config = await Config.load(BIN);
const topics = new Set();
for (const id of config.commandIDs) id.split(':').slice(0, -1).forEach((_, i, a) => topics.add(a.slice(0, i + 1).join(':')));
const cases = [[], ...[...topics].sort().map((t) => t.split(':')), ...[...config.commandIDs].sort().map((id) => id.split(':'))];

async function render(HelpClass, argv) {
  // A fresh config per page, as each CLI run has: a help render leaves state on the config it was given (a second
  // render on the same config drops a topic's COMMANDS section, with either class).
  const config = await Config.load(BIN);
  let text = '';
  const write = process.stdout.write;
  process.stdout.write = (chunk) => {
    text += String(chunk);
    return true;
  };
  try {
    await new HelpClass(config, config.pjson.oclif.helpOptions ?? config.pjson.helpOptions).showHelp(argv);
  } catch (error) {
    // A command-id prefix that is no topic (e.g. `flags`) is refused by help; both classes must refuse it alike.
    text += `ERROR ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    process.stdout.write = write;
  }
  return text;
}

const mismatches = [];
for (const argv of cases) {
  const bundled = await render(Bundled, argv);
  const unbundled = await render(Unbundled, argv);
  if (bundled !== unbundled || bundled === '') mismatches.push({ argv, bundled, unbundled });
}
process.stdout.write(`${JSON.stringify({ cases: cases.length, commands: config.commandIDs.length, mismatches })}\n`);
