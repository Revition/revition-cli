// An experimental command (T1.1.1 AC3): hidden from help and refused without the opt-in.
import { RevitionCommand } from '@revition/cli-core';

export default class FixtureLab extends RevitionCommand {
  static summary = 'An experimental fixture.';
  static examples = ['revition fixture lab --experimental'];
  static meta = {
    id: 'fixture:lab',
    summary: 'An experimental fixture.',
    examples: ['revition fixture lab --experimental'],
    requiredScopes: [],
    mutates: false,
    confirm: 'none',
    jsonSchemaId: null,
    stability: 'experimental',
  };

  async run2() {
    return { ran: true };
  }
}
