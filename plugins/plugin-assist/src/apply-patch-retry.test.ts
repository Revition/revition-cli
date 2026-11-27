import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyUnifiedPatch, StalePatch } from './executor/diff.js';
import { PatchRetryGuard } from './ui/patch-retry-guard.js';

// The starter's main.ts exactly as the user's re-run as_c0acaf92 had it (auditor #604).
const MAIN_TS = [
  'export async function main(input: { name?: string }): Promise<{ greeting: string }> {',
  "  return { greeting: `Hi ${input.name ?? 'world'}` };",
  '}',
  '',
].join('\n');
const FIXED = MAIN_TS.replace('`Hi ${', '`Hello, ${');

describe('[CLI-T3.4.1-AC1] apply_patch places a hunk whose line numbers are off (user re-run as_c0acaf92)', () => {
  it('[CLI-T3.4.1-AC1] a one-line hunk dated @@ -1 for the line-2 greeting applies at line 2', () => {
    const patch = [
      '--- a/capabilities/hello-tool/main.ts',
      '+++ b/capabilities/hello-tool/main.ts',
      '@@ -1,1 +1,1 @@',
      "-  return { greeting: `Hi ${input.name ?? 'world'}` };",
      "+  return { greeting: `Hello, ${input.name ?? 'world'}` };",
      '',
    ].join('\n');
    assert.equal(applyUnifiedPatch(MAIN_TS, patch), FIXED);
  });

  it('[CLI-T3.4.1-AC1] the exactly-dated hunk, with or without context, applies as before', () => {
    const exact = ['@@ -2,1 +2,1 @@', "-  return { greeting: `Hi ${input.name ?? 'world'}` };", "+  return { greeting: `Hello, ${input.name ?? 'world'}` };", ''].join('\n');
    assert.equal(applyUnifiedPatch(MAIN_TS, exact), FIXED);
    const withContext = [
      '@@ -1,3 +1,3 @@',
      ' export async function main(input: { name?: string }): Promise<{ greeting: string }> {',
      "-  return { greeting: `Hi ${input.name ?? 'world'}` };",
      "+  return { greeting: `Hello, ${input.name ?? 'world'}` };",
      ' }',
      '',
    ].join('\n');
    assert.equal(applyUnifiedPatch(MAIN_TS, withContext), FIXED);
  });

  it('[CLI-T3.4.1-AC1] old lines that match nowhere are refused, saying what the file has and what the patch expects', () => {
    const wrong = ['@@ -2,1 +2,1 @@', '-  return { greeting: "Hi" };', '+  return { greeting: "Hello" };', ''].join('\n');
    assert.throws(
      () => applyUnifiedPatch(MAIN_TS, wrong),
      (e: unknown) =>
        e instanceof StalePatch &&
        /line 2 does not match the patch: the file has " {2}return \{ greeting: `Hi/.test(e.message) &&
        /the patch expects " {2}return \{ greeting: \\"Hi\\" \};"/.test(e.message)
    );
  });

  it('[CLI-T3.4.1-AC1] the forms a model writes: a bare @@ header, @@ ... @@ without numbers, extra trailing newlines, a blank context line without its space', () => {
    const body = ["-  return { greeting: `Hi ${input.name ?? 'world'}` };", "+  return { greeting: `Hello, ${input.name ?? 'world'}` };"];
    assert.equal(applyUnifiedPatch(MAIN_TS, ['@@', ...body, '', ''].join('\n')), FIXED);
    assert.equal(applyUnifiedPatch(MAIN_TS, ['--- main.ts', '+++ main.ts', '@@ main @@', ...body].join('\n')), FIXED);
    const spaced = 'a\n\nb\nc\n';
    assert.equal(applyUnifiedPatch(spaced, '@@ -1,4 +1,4 @@\n a\n\n-b\n+B\n c\n'), 'a\n\nB\nc\n');
  });

  it('[CLI-T3.4.1-AC1] old lines that match two places are refused (never a guess)', () => {
    const twice = 'a\nx\nb\nx\n';
    assert.throws(() => applyUnifiedPatch(twice, '@@ -9,1 +9,1 @@\n-x\n+y\n'), /match 2 places \(lines 2, 4\)/);
  });
});

describe('[CLI-T3.4.1-AC1] after a failed write, a repeated read gets the error back instead (the 35-read loop)', () => {
  const read = { tool: 'read_file', args: { path: 'capabilities/hello-tool/main.ts' } };
  const tests = { tool: 'read_file', args: { path: 'capabilities/hello-tool/tests.json' } };
  const patch = { tool: 'apply_patch', args: { path: 'capabilities/hello-tool/main.ts' } };

  it('[CLI-T3.4.1-AC1] the first read after the failure runs; the same read again is answered with the patch error', () => {
    const g = new PatchRetryGuard();
    g.note(patch, { tool: 'apply_patch', ok: false, error: 'line 1 does not match the patch' });
    assert.equal(g.check(read), null);
    g.note(read, { tool: 'read_file', ok: true, output: {} });
    assert.equal(g.check(tests), null);
    g.note(tests, { tool: 'read_file', ok: true, output: {} });
    const again = g.check(read);
    assert.equal(again?.ok, false);
    assert.match(String(again?.error), /already read since the change to capabilities\/hello-tool\/main\.ts failed \(line 1 does not match the patch\)/);
    assert.match(String(again?.error), /send a corrected apply_patch/);
    assert.equal(g.check(tests)?.ok, false);
  });

  it('[CLI-T3.4.1-AC1] a successful write ends it; a declined write and plain reading never start it', () => {
    const g = new PatchRetryGuard();
    g.note(read, { tool: 'read_file', ok: true });
    assert.equal(g.check(read), null);
    g.note(patch, { tool: 'apply_patch', ok: false, error: 'declined by the developer' });
    g.note(read, { tool: 'read_file', ok: true });
    assert.equal(g.check(read), null);
    g.note(patch, { tool: 'apply_patch', ok: false, error: 'line 1 does not match the patch' });
    g.note(read, { tool: 'read_file', ok: true });
    assert.notEqual(g.check(read), null);
    g.note(patch, { tool: 'apply_patch', ok: true, output: {} });
    assert.equal(g.check(read), null);
  });
});
