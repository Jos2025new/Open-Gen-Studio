import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM check script
import { check } from '../scripts/check-it-fails.mjs';

/** Errors reported by check-it-fails for a single fixture test file. */
function errorsFor(source: string): string[] {
  const root = mkdtempSync(join(tmpdir(), 'ogs-sonnet-m7-'));
  try {
    mkdirSync(join(root, 'tests'));
    writeFileSync(join(root, 'tests/a.test.ts'), source);
    return check(root) as string[];
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('check-it-fails: evasions (ataque Sonnet, punto 12)', () => {
  it('control: a plain undocumented it.fails is flagged', () => {
    expect(errorsFor("it.fails('x', () => {});")).toHaveLength(1);
  });

  it('flags it.fails.each without a reproduce comment', () => {
    expect(errorsFor("it.fails.each([1])('x', () => {});")).toHaveLength(1);
  });

  it('flags test.fails without a reproduce comment', () => {
    expect(errorsFor("test.fails('x', () => {});")).toHaveLength(1);
  });

  it('flags an aliased it.fails without a reproduce comment', () => {
    expect(errorsFor("const f = it.fails; f('x', () => {});")).toHaveLength(1);
  });

  it('flags it["fails"] without a reproduce comment', () => {
    expect(errorsFor("it['fails']('x', () => {});")).toHaveLength(1);
  });

  it('flags a second it.fails that only shares the previous reproduce comment', () => {
    expect(errorsFor("// reproduce: bug A\nit.fails('a', () => {});\nit.fails('b', () => {});")).toHaveLength(1);
  });

  it('does not accept a reproduce marker that lives inside a string', () => {
    expect(errorsFor("const s = '// reproduce: x';\nit.fails('x', () => {});")).toHaveLength(1);
  });
});

describe('check-it-fails: re-ataque (b609b8f0)', () => {
  it('flags test.fails on a test created with it.extend', () => {
    expect(errorsFor("import { it } from 'vitest';\nconst test = it.extend({});\ntest.fails('x', () => {});")).toHaveLength(1);
  });

  it('flags .fails on an alias of it.skip / it.concurrent', () => {
    expect(errorsFor("const s = it.skip; s.fails('x', () => {});")).toHaveLength(1);
  });

  it('flags it.fails obtained through dynamic or default import of vitest', () => {
    expect(errorsFor("const { it: t } = await import('vitest');\nt.fails('x', () => {});")).toHaveLength(1);
  });
});
