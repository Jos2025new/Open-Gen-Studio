import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// docs/persistencia-protegida.md: the tests behind the protected save. Each must exist, be linked from that doc and
// carry no skip/only/todo mark. It does not see cases removed inside a file or weakened assertions: review does.
export const PROTECTED_TESTS = [
  'save-guard-review', 'save-guard-server', 'save-guard-client', 'save-guard-banner', 'save-now', 'raster-persist',
  'writer-lock', 'writer-lock-handoff', 'writer-lock-panel', 'writer-lock-raster', 'state-conflict', 'state-copies',
].map((name) => `tests/${name}.test.ts`);
export const DOC = 'docs/persistencia-protegida.md';
// it.skip, describe.only, test.todo, it.concurrent.skip, xit, xdescribe, fit, fdescribe.
const EXCLUDED = /\b(?:(?:it|test|describe|suite|bench)(?:\.\w+)*\.(?:skip|only|todo|skipIf|runIf)\b|(?:x|f)(?:it|test|describe)\s*\()/;

export function protectedViolations(read) {
  const errors = [];
  const doc = read(DOC);
  if (doc == null) return [`${DOC}: missing`];
  for (const path of PROTECTED_TESTS) {
    if (!doc.includes(`../${path}`)) errors.push(`${DOC}: does not link ${path}`);
    const text = read(path);
    if (text == null) { errors.push(`${path}: missing`); continue; }
    text.split('\n').forEach((line, i) => {
      if (EXCLUDED.test(line)) errors.push(`${path}:${i + 1}: excluded test (${line.trim().slice(0, 60)})`);
    });
  }
  return errors;
}

export function checkProtected(root) {
  const read = (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null);
  const errors = protectedViolations(read);
  if (errors.length) throw new Error(`check-protected: FAIL\n${errors.join('\n')}`);
  console.log(`check-protected: PASS (${PROTECTED_TESTS.length} protected test files present, none excluded)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { checkProtected(process.cwd()); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
