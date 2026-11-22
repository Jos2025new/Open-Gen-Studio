import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM check script
import { check } from '../scripts/check-budget-verdict.mjs';

function withTempRepo(files: Record<string, string>, fn: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'ogs-budget-verdict-'));
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

describe('check-budget-verdict', () => {
  it('passes on the real repository', () => {
    expect(check('.')).toEqual([]);
  });

  it('rejects direct, aliased, namespace, dynamic, and re-export imports outside the allowed boundary', () => {
    withTempRepo({
      'src/engine/budget.ts': 'export const overLimit = () => false; export const budgetVerdict = () => ({ over: false });',
      'src/engine/credit.ts': "import { budgetVerdict } from './budget'; export const ok = budgetVerdict;",
      'src/components/ui/useBudgetVerdict.ts': "import { budgetVerdict } from '../../engine/budget'; export const ok = budgetVerdict;",
      'src/engine/badDirect.ts': "import { overLimit } from './budget'; export const x = overLimit;",
      'src/components/chat/BadUi.tsx': "import { budgetVerdict as bv } from '../../engine/budget'; export const x = bv;",
      'src/engine/badNs.ts': "import * as B from './budget'; export const x = () => B.overLimit();",
      'src/engine/badNsDestructure.ts': "import * as B from './budget'; const { budgetVerdict, overLimit: ol } = B; export const x = [budgetVerdict, ol];",
      'src/engine/badNsAlias.ts': "import * as B from './budget'; const C = B; let fn; ({ budgetVerdict: fn } = C); export const x = fn;",
      'src/engine/badDynamic.ts': "export async function f() { const { budgetVerdict } = await import('./budget'); return budgetVerdict(); }",
      'src/engine/badDynamicAlias.ts': "export async function f() { const B = await import('./budget'); const { overLimit } = B; return overLimit(); }",
      'src/engine/badReexport.ts': "export { overLimit } from './budget';",
      'src/engine/goodHelper.ts': "import { budgetProblem, type BudgetVerdict } from './budget'; export type V = BudgetVerdict; export const x = budgetProblem;",
    }, (root) => {
      const errors: string[] = check(root);
      expect(errors.some((e) => e.startsWith('src/engine/badDirect.ts:'))).toBe(true);
      expect(errors.some((e) => e.startsWith('src/components/chat/BadUi.tsx:'))).toBe(true);
      expect(errors.some((e) => e.startsWith('src/engine/badNs.ts:'))).toBe(true);
      expect(errors.some((e) => e.startsWith('src/engine/badNsDestructure.ts:'))).toBe(true);
      expect(errors.some((e) => e.startsWith('src/engine/badNsAlias.ts:'))).toBe(true);
      expect(errors.some((e) => e.startsWith('src/engine/badDynamic.ts:'))).toBe(true);
      expect(errors.some((e) => e.startsWith('src/engine/badDynamicAlias.ts:'))).toBe(true);
      expect(errors.some((e) => e.startsWith('src/engine/badReexport.ts:'))).toBe(true);
      expect(errors.some((e) => e.startsWith('src/engine/credit.ts:'))).toBe(false);
      expect(errors.some((e) => e.startsWith('src/components/ui/useBudgetVerdict.ts:'))).toBe(false);
      expect(errors.some((e) => e.startsWith('src/engine/goodHelper.ts:'))).toBe(false);
    });
  });
});
