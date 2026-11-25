// A mutating fixture (T1.1.1 AC2): needs a confirmation, or --yes in non-interactive mode.
import { RevitionCommand } from '@revition/cli-core';

export default class FixtureDelete extends RevitionCommand {
  static summary = 'Delete something (fixture).';
  static examples = ['revition fixture delete --yes'];
  static meta = {
    id: 'fixture:delete',
    summary: 'Delete something (fixture).',
    examples: ['revition fixture delete --yes'],
    requiredScopes: [],
    mutates: true,
    confirm: 'prompt',
    jsonSchemaId: 'revition.fixture.delete.v1',
    stability: 'stable',
  };

  async run2() {
    return { deleted: true };
  }
}
