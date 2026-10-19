import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { DOC, PROTECTED_TESTS, protectedViolations } from '../scripts/check-protected.mjs';

// The real repository as a reader, with one file replaced or removed.
const real = (path: string): string | null => { try { return readFileSync(path, 'utf8'); } catch { return null; } };
const withFile = (target: string, text: string | null) => (path: string) => (path === target ? text : real(path));
const first = PROTECTED_TESTS[0];

it('passes with the protected tests intact', () => {
  expect(protectedViolations(real)).toEqual([]);
});

it('fails when a protected test file is missing', () => {
  expect(protectedViolations(withFile(first, null))).toEqual([`${first}: missing`]);
});

it('fails when the doc stops linking a protected test', () => {
  const doc = real(DOC)!.replaceAll(`../${first}`, '../tests/other.test.ts');
  expect(protectedViolations(withFile(DOC, doc))).toEqual([`${DOC}: does not link ${first}`]);
});

it.each([
  "it.skip('loses work', () => {})",
  "describe.only('guard', () => {})",
  "it.todo('later')",
  "test.skipIf(true)('x', () => {})",
  "it.concurrent.skip('x', () => {})",
  "xit('x', () => {})",
  "fdescribe('x', () => {})",
])('fails on an exclusion mark: %s', (line) => {
  const text = `${real(first)}\n${line}\n`;
  const errors = protectedViolations(withFile(first, text));
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatch(new RegExp(`^${first}:\\d+: excluded test`));
});

it('does not flag ordinary words that contain the marks', () => {
  const text = `${real(first)}\nconst skipped = state.only; // "it.skipping" is prose\n`;
  expect(protectedViolations(withFile(first, text))).toEqual([]);
});
