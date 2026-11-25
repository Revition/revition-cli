// The networked-command runtime moved into @revition/cli-core (T2.1.1: first-party plugins sign in the same way);
// the shell's commands keep importing it from here.
export { logoutDeps, passphrasePrompt, runtime, storeFor, type Runtime } from '@revition/cli-core';
