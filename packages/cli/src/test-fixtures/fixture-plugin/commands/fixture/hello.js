// A sample command module: it declares its contract and returns data; the core does everything else.
import { RevitionCommand } from '@revition/cli-core';

export default class FixtureHello extends RevitionCommand {
  static summary = 'Say hello (fixture).';
  static examples = ['revition fixture hello'];
  static meta = {
    id: 'fixture:hello',
    summary: 'Say hello (fixture).',
    examples: ['revition fixture hello'],
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.fixture.hello.v1',
    stability: 'stable',
  };

  async run2() {
    return { greeting: 'hello from a module the core never saw' };
  }

  human(data) {
    return { text: `${data.greeting}\n` };
  }
}
