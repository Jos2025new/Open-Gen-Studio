import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM check script
import { check } from '../scripts/check-it-fails.mjs';

function withTempTests(files: Record<string, string>, fn: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'ogs-it-fails-'));
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

describe('check-it-fails', () => {
  it('passes on the real repository and is wired into npm test via check-all', () => {
    expect(check('.')).toEqual([]);
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    const checkAll = readFileSync('scripts/check-all.mjs', 'utf8');
    expect(pkg.scripts.test).toContain('node scripts/check-all.mjs');
    expect(checkAll).toContain('scripts/check-it-fails.mjs');
  });

  it('rejects it.fails without `// reproduce:` in the 3 preceding lines and accepts documented ones', () => {
    withTempTests({
      'tests/missing.test.ts': `
        import { it } from 'vitest';
        it.fails('undocumented bug', () => {});
      `,
      'tests/too-far.test.ts': `
        import { it } from 'vitest';
        // reproduce: bug is 4 lines above
        // filler 1
        // filler 2
        // filler 3
        it.fails('too far', () => {});
      `,
      'tests/empty-repro.test.ts': `
        import { it } from 'vitest';
        // reproduce:
        it.fails('empty comment', () => {});
      `,
      'tests/ok-1-line.test.ts': `
        import { it } from 'vitest';
        // reproduce: foo fails when bar is null
        it.fails('one line above', () => {});
      `,
      'tests/ok-3-lines.test.ts': `
        import { it } from 'vitest';
        // reproduce: foo fails when bar is null
        // extra context 1
        // extra context 2
        it.fails('three lines above', () => {});
      `,
      'tests/string-only.test.ts': `
        import { expect, it } from 'vitest';
        it('ignores string literals mentioning it.fails', () => {
          expect("it.fails('nope')").toContain('it.fails');
        });
      `,
    }, (root) => {
      const errors: string[] = check(root);
      expect(errors.some((e) => e.startsWith('tests/missing.test.ts:'))).toBe(true);
      expect(errors.some((e) => e.startsWith('tests/too-far.test.ts:'))).toBe(true);
      expect(errors.some((e) => e.startsWith('tests/empty-repro.test.ts:'))).toBe(true);
      expect(errors.some((e) => e.startsWith('tests/ok-1-line.test.ts:'))).toBe(false);
      expect(errors.some((e) => e.startsWith('tests/ok-3-lines.test.ts:'))).toBe(false);
      expect(errors.some((e) => e.startsWith('tests/string-only.test.ts:'))).toBe(false);
    });
  });

  it('catches member chains, test.fails, aliases, bracket access, shared comments, and string-embedded markers', () => {
    withTempTests({
      'tests/chains.test.ts': `
        it.fails.each([1])('a', () => {});
        it.concurrent.fails('b', () => {});
        it.skip.fails('c', () => {});
        // reproduce: documented chain
        it.concurrent.fails('d', () => {});
      `,
      'tests/test-and-aliases.test.ts': `
        import { it as t, test as myTest } from 'vitest';
        test.fails('a', () => {});
        t.fails('b', () => {});
        myTest.skip.fails('c', () => {});
        const f = it.fails;
        f('d', () => {});
        const { fails } = it;
        fails('e', () => {});
        // reproduce: documented alias
        f('ok', () => {});
      `,
      'tests/bracket.test.ts': `
        it['fails']('a', () => {});
        // reproduce: documented bracket
        it['fails']('b', () => {});
      `,
      'tests/shared-and-string.test.ts': `
        // reproduce: bug A
        it.fails('a', () => {});
        it.fails('b', () => {});
        const s = '// reproduce: fake';
        it.fails('c', () => {});
        const tpl = \`
        // reproduce: template fake
        \`;
        it.fails('d', () => {});
      `,
      'tests/non-vitest.test.ts': `
        import other from './other';
        const obj = { fails: (_msg: string, _fn: () => void) => {}, skip: { fails: (_msg: string, _fn: () => void) => {} }, extend: () => ({ fails: (_msg: string, _fn: () => void) => {} }) };
        obj.fails('not vitest', () => {});
        const s = obj.skip;
        s.fails('not vitest skip', () => {});
        obj.extend().fails('not vitest extend', () => {});
        other.it.fails('not vitest default import', () => {});
        const dyn = await import('./other');
        dyn.it.fails('not vitest dynamic import', () => {});
      `,
      'tests/extend-modifiers-and-imports.test.ts': `
        import vitest from 'vitest';
        const ext = it.extend({});
        ext.fails('a', () => {});
        const s = it.skip;
        s.fails('b', () => {});
        const c = it.concurrent;
        c.fails('c', () => {});
        const r = it.runIf(true).sequential;
        r.fails('d', () => {});
        vitest.it.fails('e', () => {});
        const { it: t } = await import('vitest');
        t.fails('f', () => {});
        (await import('vitest')).test.fails('g', () => {});
        // reproduce: documented extended test
        ext.fails('ok', () => {});
      `,
    }, (root) => {
      const errors: string[] = check(root);
      expect(errors.filter((e) => e.startsWith('tests/chains.test.ts:'))).toHaveLength(3);
      expect(errors.filter((e) => e.startsWith('tests/test-and-aliases.test.ts:'))).toHaveLength(5);
      expect(errors.filter((e) => e.startsWith('tests/bracket.test.ts:'))).toHaveLength(1);
      expect(errors.filter((e) => e.startsWith('tests/shared-and-string.test.ts:'))).toHaveLength(3);
      expect(errors.filter((e) => e.startsWith('tests/non-vitest.test.ts:'))).toHaveLength(0);
      expect(errors.filter((e) => e.startsWith('tests/extend-modifiers-and-imports.test.ts:'))).toHaveLength(7);
    });
  });
});
