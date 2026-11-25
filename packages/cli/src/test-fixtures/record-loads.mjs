// TEST-ONLY preload (startup-path.test.ts): records every module URL the process resolves and writes the list to
// $REVITION_RECORD_LOADS at exit. Uses Node's synchronous module hooks, which see both `import` and `require`.
import { writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const out = process.env['REVITION_RECORD_LOADS'];
const urls = new Set();
registerHooks({
  resolve(specifier, context, next) {
    const r = next(specifier, context);
    urls.add(r.url);
    return r;
  },
});
process.on('exit', () => {
  if (out !== undefined) writeFileSync(out, [...urls].join('\n'));
});
