/**
 * A project directory: read as the platform's files (hidden entries, node_modules and dist never read), written
 * without ever overwriting and never outside the directory.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MAX_LOCAL_FILES, readProjectDir, writeProjectDir } from './project-dir';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'revition-dir-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('reading a project', () => {
  it('every file by its posix path; hidden entries, node_modules and dist are never read', () => {
    mkdirSync(join(root, 'capabilities/a'), { recursive: true });
    mkdirSync(join(root, 'node_modules/x'), { recursive: true });
    mkdirSync(join(root, 'dist'), { recursive: true });
    mkdirSync(join(root, '.git'), { recursive: true });
    writeFileSync(join(root, 'revition.json'), '{}');
    writeFileSync(join(root, 'capabilities/a/main.ts'), 'x');
    writeFileSync(join(root, 'node_modules/x/index.js'), 'secret');
    writeFileSync(join(root, 'dist/out.js'), 'built');
    writeFileSync(join(root, '.git/config'), 'git');
    writeFileSync(join(root, '.env'), 'REVITION_TOKEN=rt');
    expect(readProjectDir(root)).toEqual({
      'capabilities/a/main.ts': 'x',
      'revition.json': '{}',
    });
  });

  it('stops at the local cap instead of reading a whole tree', () => {
    for (let i = 0; i <= MAX_LOCAL_FILES; i++) {
      writeFileSync(join(root, `f${i}.txt`), '');
    }
    expect(() => readProjectDir(root)).toThrow(/is this a project directory\?/);
  });
});

describe('writing a project', () => {
  it('writes every file, creating folders', () => {
    expect(writeProjectDir(join(root, 'p'), { 'b/c.ts': 'c', 'a.json': 'a' })).toEqual([
      'a.json',
      'b/c.ts',
    ]);
    expect(readFileSync(join(root, 'p/b/c.ts'), 'utf8')).toBe('c');
  });

  it('never overwrites: one existing file stops it before anything is written', () => {
    mkdirSync(join(root, 'p'));
    writeFileSync(join(root, 'p/a.json'), 'mine');
    expect(() => writeProjectDir(join(root, 'p'), { 'a.json': 'theirs', 'b.ts': 'b' })).toThrow(
      /already has a\.json: nothing was written/
    );
    expect(readFileSync(join(root, 'p/a.json'), 'utf8')).toBe('mine');
    expect(existsSync(join(root, 'p/b.ts'))).toBe(false);
  });

  it('never writes outside the directory', () => {
    for (const bad of ['../evil.ts', 'a/../../evil.ts', '/etc/evil']) {
      expect(() => writeProjectDir(join(root, 'p'), { [bad]: 'x' })).toThrow(/outside the project/);
    }
    expect(existsSync(join(root, 'evil.ts'))).toBe(false);
  });
});
