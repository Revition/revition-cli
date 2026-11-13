import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkRepo, findViolations } from './check-pinned-actions.mjs';

const SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1';

test('an action on a tag (@v4) is refused', () => {
  const v = findViolations('    steps:\n      - uses: actions/checkout@v4\n', 'ci.yml');
  assert.equal(v.length, 1);
  assert.match(v[0], /ci\.yml:2: action not pinned to a full commit SHA: actions\/checkout@v4/);
});

test('an action on a branch or a short SHA is refused', () => {
  assert.equal(findViolations('- uses: actions/checkout@main\n', 'a.yml').length, 1);
  assert.equal(findViolations('- uses: actions/checkout@3d3c42e\n', 'a.yml').length, 1);
});

test('an action pinned to a full commit SHA passes, with or without a version comment', () => {
  assert.deepEqual(findViolations(`- uses: actions/checkout@${SHA} # v7.0.1\n`, 'a.yml'), []);
  assert.deepEqual(findViolations(`- uses: github/codeql-action/init@${SHA}\n`, 'a.yml'), []);
});

test('a local action passes; a docker image needs a digest', () => {
  assert.deepEqual(findViolations('- uses: ./.github/actions/setup\n', 'a.yml'), []);
  assert.equal(findViolations('- uses: docker://alpine:3.20\n', 'a.yml').length, 1);
  assert.deepEqual(findViolations(`- uses: docker://alpine@sha256:${'a'.repeat(64)}\n`, 'a.yml'), []);
});

test('a pull_request_target workflow that checks code out is refused', () => {
  const text = `on:\n  pull_request_target:\njobs:\n  x:\n    steps:\n      - uses: actions/checkout@${SHA}\n`;
  assert.ok(findViolations(text, 'bad.yml').some((l) => /pull_request_target/.test(l)));
});

test("this repository's own workflows have no violation", () => {
  assert.deepEqual(checkRepo(process.cwd()), []);
});
