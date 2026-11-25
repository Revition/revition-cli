// TEST-ONLY preload (ctrl-c.ts). On Windows a console Ctrl-C reaches Node as a 'SIGINT' event, but a test cannot press
// Ctrl-C in a child's console, and child.kill('SIGINT') there terminates the child outright (no handler runs, exit
// code null: the windows-latest CI run). The test sends this message instead and the bridge raises the same 'SIGINT'
// event the console would, so the CLI's real Ctrl-C handler (exit 11 + cleanup) is what runs.
if (typeof process.send === 'function') {
  process.on('message', (m) => {
    if (m === 'revition:ctrl-c') process.emit('SIGINT');
  });
  process.channel?.unref();
}
