// Test fixture, not for use: the smallest Revition CLI plugin command. It asks for no permission and prints one line.
export async function run(ctx) {
  ctx.print('e2e-fixture-plugin: hello');
  return 0;
}
