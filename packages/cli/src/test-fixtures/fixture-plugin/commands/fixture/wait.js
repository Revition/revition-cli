// A long-running fixture (T1.1.1 AC6): prints a progress line, then waits until interrupted.
import { RevitionCommand } from '@revition/cli-core';

export default class FixtureWait extends RevitionCommand {
  static summary = 'Wait (fixture).';
  static examples = ['revition fixture wait'];
  static meta = {
    id: 'fixture:wait',
    summary: 'Wait (fixture).',
    examples: ['revition fixture wait'],
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: null,
    stability: 'stable',
  };

  async run2(ctx) {
    ctx.io.err('waiting\n');
    ctx.io.flush();
    await new Promise((resolve) => setTimeout(resolve, 60_000));
    return null;
  }
}
