// A command behind a server-delivered feature flag (T1.4.3 AC1/AC2): hidden and refused while `cli.fixture` is off.
import { RevitionCommand } from '@revition/cli-core';

export default class FixtureFlagged extends RevitionCommand {
  static summary = 'A flagged fixture.';
  static examples = ['revition fixture flagged'];
  static meta = {
    id: 'fixture:flagged',
    summary: 'A flagged fixture.',
    examples: ['revition fixture flagged'],
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: null,
    stability: 'stable',
    featureFlag: 'cli.fixture',
  };

  async run2() {
    return { ran: true };
  }
}
