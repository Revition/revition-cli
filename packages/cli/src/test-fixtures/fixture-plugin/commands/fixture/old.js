// A deprecated command (T1.5.1 AC3): it warns and still works.
import { RevitionCommand } from '@revition/cli-core';

export default class FixtureOld extends RevitionCommand {
  static summary = 'An old command (fixture).';
  static examples = ['revition fixture old'];
  static meta = {
    id: 'fixture:old',
    summary: 'An old command (fixture).',
    examples: ['revition fixture old'],
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: 'revition.fixture.old.v1',
    stability: 'stable',
    deprecated: { since: '0.2.0', removeIn: '1.0.0', replacement: 'fixture:hello' },
  };

  async run2() {
    return { still: 'works' };
  }

  human(data) {
    return { text: `${data.still}\n` };
  }
}
