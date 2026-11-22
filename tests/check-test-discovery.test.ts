import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { check, globToRegExp } from '../scripts/check-test-discovery.mjs';

function withTempRepo(files: Record<string, string>, fn: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'ogs-test-discovery-'));
  try {
    for (const [rel, text] of Object.entries(files)) {
      const full = join(root, rel);
      mkdirSync(full.slice(0, full.lastIndexOf('/')), { recursive: true });
      writeFileSync(full, text);
    }
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('check-test-discovery', () => {
  it('passes on the real repository', () => {
    expect(check('.')).toEqual([]);
  });

  it('matches nested and root paths with globToRegExp', () => {
    const re = globToRegExp('tests/**/*.test.ts');
    expect(re.test('tests/foo.test.ts')).toBe(true);
    expect(re.test('tests/e2e/foo.test.ts')).toBe(true);
    expect(re.test('tests/a/b/foo.test.ts')).toBe(true);
    expect(re.test('tests/foo.test.tsx')).toBe(false);
  });

  it('fails with file:line and fix hint when a .test.tsx or .test.js file is left out of test.include', () => {
    withTempRepo({
      'vite.config.ts': `export default { test: { include: ['tests/**/*.test.ts'] } };\n`,
      'tests/runs.test.ts': 'export {};',
      'tests/nested/runs.test.ts': 'export {};',
      'tests/missed.test.tsx': 'export {};',
      'tests/sub/also-missed.test.js': 'export {};',
      'tests/helper.ts': 'export {};',
    }, (root) => {
      const errors = check(root, { excluded: new Map() });
      expect(errors).toHaveLength(2);
      expect(errors[0]).toMatch(/^tests\/missed\.test\.tsx:1:.*vite\.config\.ts:1/);
      expect(errors[1]).toMatch(/^tests\/sub\/also-missed\.test\.js:1:.*vite\.config\.ts:1/);
    });
  });

  it('respects explicit exclusions and fails closed when test.include is missing', () => {
    withTempRepo({
      'vite.config.ts': `export default { test: { include: ['tests/**/*.test.ts'] } };\n`,
      'tests/manual.test.mjs': 'export {};',
    }, (root) => {
      expect(check(root, { excluded: new Map([['tests/manual.test.mjs', 'manual only']]) })).toEqual([]);
      expect(check(root, { excluded: new Map() })).toEqual([expect.stringContaining('tests/manual.test.mjs:1:')]);
    });

    withTempRepo({
      'vite.config.ts': `export default { plugins: [] };\n`,
      'tests/a.test.ts': 'export {};',
    }, (root) => {
      expect(check(root, { excluded: new Map() })).toEqual([expect.stringContaining('vite.config.ts:1: missing `test.include`')]);
    });
  });
});
