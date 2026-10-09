import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The measuring protocol (docs/depuracion.md#protocolo) applies only to what has probes, listed in the table «Qué se
 * mide hoy». This keeps the table and the code in step: every probe in src is listed, and every listed event exists.
 */
const PROBE = /\b(span|note|awaitFrame)\('([a-z]+)', '([a-z-]+)'/g;
// The project's node:fs types have no statSync: a folder is whatever can be listed.
const list = (dir: string): string[] | null => { try { return readdirSync(dir); } catch { return null; } };
const files = (dir: string): string[] => (list(dir) ?? []).flatMap((f) => {
  const p = join(dir, f);
  return /\.tsx?$/.test(f) ? [p] : files(p);
});

function probesInCode(): Set<string> {
  const found = new Set<string>();
  for (const file of files('src')) {
    // Code only: an example in a comment is not a probe.
    const code = readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    for (const m of code.matchAll(PROBE)) found.add(`${m[2]}.${m[3]}`);
  }
  return found;
}

function probesInDoc(): Set<string> {
  const doc = readFileSync('docs/depuracion.md', 'utf8');
  const table = doc.slice(doc.indexOf('## Qué se mide hoy'), doc.indexOf('## Añadir una sonda'));
  const listed = new Set<string>();
  for (const row of table.split('\n').filter((l) => /^\| `[a-z]+` \|/.test(l))) {
    const [, domain, events] = /^\| `([a-z]+)` \|(.*)\|$/.exec(row)!;
    for (const m of events.matchAll(/`([a-z-]+)`/g)) listed.add(`${domain}.${m[1]}`);
  }
  return listed;
}

describe('probes and the protocol table', () => {
  it('every probe in the code is in «Qué se mide hoy», and every event listed there has its probe', () => {
    const code = probesInCode(), doc = probesInDoc();
    expect(code.size).toBeGreaterThan(5);
    expect([...code].filter((p) => !doc.has(p)), 'probes missing from docs/depuracion.md').toEqual([]);
    expect([...doc].filter((p) => !code.has(p)), 'events listed with no probe in src').toEqual([]);
  });
});
