// TEST-ONLY preload (spawn-cli.ts), the same bridge as plugins/plugin-dev/src/test-fixtures/ctrl-c-bridge.mjs. On
// Windows child.kill('SIGINT') terminates the child outright (no handler runs, exit code null: windows-latest, PR #11
// run 45564271218). The test sends this message instead and the bridge raises the 'SIGINT' event a console Ctrl-C
// raises, so the CLI's real Ctrl-C handler (exit 11 + cleanup) is what runs.
if (typeof process.send === 'function') {
  process.on('message', (m) => {
    if (m === 'revition:ctrl-c') process.emit('SIGINT');
  });
  process.channel?.unref();
}
