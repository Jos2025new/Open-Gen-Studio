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

  // reproduce: `it.fails.each([1])('x', fn)` sin `// reproduce:` pasa el check (isItFailsMember solo mira `it.fails(...)`), desde d66dbdaa/6fd62afa; cierre: scripts/check-it-fails.mjs:25-33 debe reconocer toda cadena que contenga `.fails` sobre it/test (it.fails.each, it.concurrent.fails, it.skip.fails).
  it.fails('flags it.fails.each without a reproduce comment', () => {
    expect(errorsFor("it.fails.each([1])('x', () => {});")).toHaveLength(1);
  });

  // reproduce: `test.fails('x', fn)` (alias oficial de it.fails en vitest) sin `// reproduce:` pasa el check, desde 6fd62afa; cierre: scripts/check-it-fails.mjs:25-33 debe aceptar `test` ademas de `it`.
  it.fails('flags test.fails without a reproduce comment', () => {
    expect(errorsFor("test.fails('x', () => {});")).toHaveLength(1);
  });

  // reproduce: `import { it as t }` + `t.fails(...)` o `const f = it.fails; f(...)` pasan el check sin comentario, desde 6fd62afa; cierre: scripts/check-it-fails.mjs:25-33 debe resolver alias de import/variable o prohibirlos.
  it.fails('flags an aliased it.fails without a reproduce comment', () => {
    expect(errorsFor("const f = it.fails; f('x', () => {});")).toHaveLength(1);
  });

  // reproduce: `it['fails']('x', fn)` sin comentario pasa porque el prefiltro `text.includes('it.fails')` descarta el archivo antes de parsear, desde 6fd62afa; cierre: scripts/check-it-fails.mjs:48 quitar o ampliar el prefiltro (`fails`).
  it.fails('flags it["fails"] without a reproduce comment', () => {
    expect(errorsFor("it['fails']('x', () => {});")).toHaveLength(1);
  });

  // reproduce: un solo `// reproduce:` cubre a varios it.fails consecutivos (ventana de 3 lineas compartida): el segundo y tercero quedan sin dueño, desde 6fd62afa; cierre: scripts/check-it-fails.mjs:61-63 exigir que el comentario sea el inmediato anterior y no lo comparta otro it.fails.
  it.fails('flags a second it.fails that only shares the previous reproduce comment', () => {
    expect(errorsFor("// reproduce: bug A\nit.fails('a', () => {});\nit.fails('b', () => {});")).toHaveLength(1);
  });

  // reproduce: `// reproduce:` dentro de un string/template cuenta como comentario porque REPRODUCE_RE se aplica a lineas crudas, desde 6fd62afa; cierre: scripts/check-it-fails.mjs:61-63 usar los comentarios del AST (program.comments) en vez de lineas crudas.
  it.fails('does not accept a reproduce marker that lives inside a string', () => {
    expect(errorsFor("const s = '// reproduce: x';\nit.fails('x', () => {});")).toHaveLength(1);
  });
});
