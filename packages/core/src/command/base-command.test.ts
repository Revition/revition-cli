import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RevitionCliError } from '../errors/cli-error.js';
import { isEnvelope } from '../output/envelope.js';
import { memoryIo } from '../output/io.js';

import { executeCommand, readlineTerminal, settledLine, usageMessageOf, type PipelineInput } from './base-command.js';
import type { BaseFlagValues, CoreServices } from './context.js';
import type { CommandMeta } from './contract.js';

const META: CommandMeta = {
  id: 'apps:list',
  summary: 'List apps.',
  examples: ['revition apps list'],
  requiredScopes: ['cli:read'],
  mutates: false,
  confirm: 'none',
  jsonSchemaId: 'revition.apps.list.v1',
  stability: 'stable',
};
const FLAGS: BaseFlagValues = {
  json: false,
  noInput: false,
  yes: false,
  experimental: false,
  profile: undefined,
  debug: false,
  color: 'never',
};
const SIGNED_IN: CoreServices = {
  loadProfile: async (p) => ({ name: p ?? 'default' }),
  resolveAuth: async () => ({ scopes: ['cli:read'] }),
  featureEnabled: async () => false,
};

function input(over: Partial<PipelineInput<unknown>> & { tty?: boolean; answers?: string[] } = {}) {
  const io = memoryIo({ tty: over.tty ?? false, answers: over.answers ?? [] });
  let ran = 0;
  const base: PipelineInput<unknown> = {
    meta: META,
    flags: FLAGS,
    args: {},
    commandFlags: {},
    env: {},
    io,
    cliVersion: '0.1.0',
    services: SIGNED_IN,
    run2: async () => {
      ran++;
      return { apps: ['a1'] };
    },
    human: (d) => ({ text: `${JSON.stringify(d)}\n` }),
    confirmTarget: () => null,
    writeHuman: async (t) => io.out(t),
    ...over,
  };
  return { base: { ...base, io }, io, ran: () => ran };
}

describe('T1.1.1 the base command pipeline', () => {
  it('[CLI-T1.1.1-AC1] renders the data (human to stdout; --json = one envelope) and exits 0', async () => {
    const h = input();
    assert.equal(await executeCommand(h.base), 0);
    assert.equal(h.io.stdout(), '{"apps":["a1"]}\n');
    const j = input({ flags: { ...FLAGS, json: true } });
    assert.equal(await executeCommand(j.base), 0);
    const doc = JSON.parse(j.io.stdout()) as unknown;
    assert.ok(isEnvelope(doc));
    assert.equal(j.io.stdout().trim().split('\n').length, 1);
  });

  it('[CLI-T1.1.1-AC1] not signed in -> exit 3; missing scope -> exit 4; nothing runs', async () => {
    const anon = input({ services: { ...SIGNED_IN, resolveAuth: async () => null } });
    assert.equal(await executeCommand(anon.base), 3);
    assert.equal(anon.ran(), 0);
    const narrow = input({
      meta: { ...META, requiredScopes: ['cli:write'] },
      services: SIGNED_IN,
    });
    assert.equal(await executeCommand(narrow.base), 4);
    assert.match(narrow.io.stderr(), /cli:write/);
    assert.equal(narrow.ran(), 0);
  });

  it('[CLI-T1.1.1-AC2] mutating + --no-input without --yes -> exit 2 with guidance; --yes runs; a TTY prompts', async () => {
    const mutating: CommandMeta = { ...META, id: 'apps:delete', mutates: true, confirm: 'prompt' };
    const refused = input({ meta: mutating, flags: { ...FLAGS, noInput: true } });
    assert.equal(await executeCommand(refused.base), 2);
    assert.match(refused.io.stderr(), /--yes/);
    assert.equal(refused.ran(), 0);
    const yes = input({ meta: mutating, flags: { ...FLAGS, noInput: true, yes: true } });
    assert.equal(await executeCommand(yes.base), 0);
    assert.equal(yes.ran(), 1);
    const declined = input({ meta: mutating, tty: true, answers: ['n'] });
    assert.equal(await executeCommand(declined.base), 11);
    assert.equal(declined.ran(), 0);
    const accepted = input({ meta: mutating, tty: true, answers: ['y'] });
    assert.equal(await executeCommand(accepted.base), 0);
    const typed = input({ meta: { ...mutating, confirm: 'typed' }, tty: true, answers: ['wrong'], confirmTarget: () => 'my-app' });
    assert.equal(await executeCommand(typed.base), 11);
    const typedOk = input({ meta: { ...mutating, confirm: 'typed' }, tty: true, answers: ['my-app'], confirmTarget: () => 'my-app' });
    assert.equal(await executeCommand(typedOk.base), 0);
    // --json disables prompts even on a TTY.
    const jsonTty = input({ meta: mutating, tty: true, flags: { ...FLAGS, json: true } });
    assert.equal(await executeCommand(jsonTty.base), 2);
  });

  it('[CLI-T1.1.1-AC3] experimental refuses without the opt-in (flag or REVITION_EXPERIMENTAL=1); beta warns', async () => {
    const exp: CommandMeta = { ...META, stability: 'experimental' };
    const refused = input({ meta: exp });
    assert.equal(await executeCommand(refused.base), 2);
    assert.match(refused.io.stderr(), /experimental/);
    assert.equal(refused.ran(), 0);
    assert.equal(await executeCommand(input({ meta: exp, flags: { ...FLAGS, experimental: true } }).base), 0);
    assert.equal(await executeCommand(input({ meta: exp, env: { REVITION_EXPERIMENTAL: '1' } }).base), 0);
    const beta = input({ meta: { ...META, stability: 'beta' }, flags: { ...FLAGS, json: true } });
    assert.equal(await executeCommand(beta.base), 0);
    assert.match(JSON.parse(beta.io.stdout()).warnings[0], /beta/);
  });

  it('[CLI-T1.1.1-AC1] a feature-flagged command is refused while its flag is off', async () => {
    const flagged = input({ meta: { ...META, featureFlag: 'cli.apps' } });
    assert.equal(await executeCommand(flagged.base), 4);
    assert.match(flagged.io.stderr(), /not available on your account yet/);
    const on = input({ meta: { ...META, featureFlag: 'cli.apps' }, services: { ...SIGNED_IN, featureEnabled: async () => true } });
    assert.equal(await executeCommand(on.base), 0);
  });

  it('[CLI-T1.1.1-AC1] a typed failure keeps its exit code; anything else is the generic message, exit 1', async () => {
    const typed = input({
      run2: async () => {
        throw new RevitionCliError({ code: 'NOT_FOUND', message: 'No such app.' }, 5);
      },
    });
    assert.equal(await executeCommand(typed.base), 5);
    const boom = input({
      flags: { ...FLAGS, json: true },
      run2: async () => {
        throw new Error('secret stack rvt_abcdefghijklmnopqrstuvwxyzABCDEF012345');
      },
    });
    assert.equal(await executeCommand(boom.base), 1);
    const out = boom.io.stdout();
    assert.match(out, /Something went wrong \(trace /);
    assert.doesNotMatch(out, /rvt_/);
  });
});

describe('[CLI-T2.5.2-AC3] UX checklist findings from the macOS walk (auditor #590)', () => {
  it('[CLI-T2.5.2-AC3] a visible prompt never puts readline in terminal mode (its redraw erased the question)', () => {
    // Terminal mode redraws an empty prompt at column 1 and clears the screen below: `init` waited on an invisible ask.
    assert.equal(readlineTerminal(false, true), false);
    assert.equal(readlineTerminal(false, false), false);
    // A hidden read still needs terminal mode to stop the echo; its own output (the redraw included) is suppressed.
    assert.equal(readlineTerminal(true, true), true);
    assert.equal(readlineTerminal(true, false), false);
  });

  it('[CLI-T2.5.2-AC3] a prompt read settles on end of input with the default answer (no unsettled await, exit 13)', async () => {
    const fake = (): {
      rl: Parameters<typeof settledLine>[0];
      answer: (a: string) => void;
      end: () => void;
    } => {
      let onAnswer: (a: string) => void = () => undefined;
      let onClose: () => void = () => undefined;
      const rl = {
        question: (_q: string, cb: (a: string) => void): void => {
          onAnswer = cb;
        },
        once: (_e: 'close', cb: () => void): unknown => {
          onClose = cb;
          return rl;
        },
        close: (): void => onClose(),
      };
      return { rl, answer: (a) => onAnswer(a), end: () => onClose() };
    };
    const eof = fake();
    const pendingEof = settledLine(eof.rl);
    eof.end();
    assert.equal(await pendingEof, '');
    const typed = fake();
    const pendingTyped = settledLine(typed.rl);
    typed.answer('y');
    assert.equal(await pendingTyped, 'y');
  });

  it('[CLI-T2.5.2-AC3] a usage error names what is missing (the whole message on one line, not its first line)', () => {
    const oclif = new Error('Missing 1 required arg:\nkind  sdk or ui.\nSee more help with --help');
    assert.equal(usageMessageOf(oclif), 'Missing 1 required arg: kind  sdk or ui.');
    assert.equal(usageMessageOf(new Error('Unexpected argument: x')), 'Unexpected argument: x');
    assert.equal(usageMessageOf('not an error'), 'Invalid usage.');
    assert.ok(usageMessageOf(new Error('a'.repeat(500))).length <= 300);
  });
});
