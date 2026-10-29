import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// check-docs: a folder index (docs/<folder>/README.md) linked from docs/README.md indexes its folder's files.
const script = join(process.cwd(), 'scripts/check-docs.mjs');
let dir = '';

function run(files: Record<string, string>): { ok: boolean; out: string } {
  dir = mkdtempSync(join(tmpdir(), 'check-docs-'));
  writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  try {
    return { ok: true, out: String(execSync(`cd "${dir}" && node "${script}" 2>&1`)) };
  } catch (error) {
    return { ok: false, out: String((error as { stdout?: unknown }).stdout ?? error) };
  }
}

afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe('check-docs folder indexes', () => {
  it('accepts a note linked only from its folder index, when that index is in docs/README.md', () => {
    const r = run({ 'docs/README.md': '- [F](f/README.md)\n', 'docs/f/README.md': '- [A](a.md)\n', 'docs/f/a.md': '# A\n' });
    expect(r.out).toContain('check-docs: PASS');
  });

  it('reports a note missing from its folder index', () => {
    const r = run({ 'docs/README.md': '- [F](f/README.md)\n', 'docs/f/README.md': '# F\n', 'docs/f/a.md': '# A\n' });
    expect(r.ok).toBe(false);
    expect(r.out).toContain('docs/f/a.md: missing from docs/f/README.md');
  });

  it('does not treat an unlinked folder index as an index', () => {
    const r = run({ 'docs/README.md': '# Index\n', 'docs/f/README.md': '- [A](a.md)\n', 'docs/f/a.md': '# A\n' });
    expect(r.ok).toBe(false);
    expect(r.out).toContain('docs/f/README.md: missing from docs/README.md');
    expect(r.out).toContain('docs/f/a.md: missing from docs/README.md');
  });

  it('reports a broken link in a folder index', () => {
    const r = run({ 'docs/README.md': '- [F](f/README.md)\n', 'docs/f/README.md': '- [A](a.md)\n- [X](gone.md)\n', 'docs/f/a.md': '# A\n' });
    expect(r.ok).toBe(false);
    expect(r.out).toContain('docs/f/README.md: broken link gone.md');
  });
});

describe('check-docs links inside folder-indexed notes', () => {
  const base = { 'docs/README.md': '- [F](f/README.md)\n- [G](g/README.md)\n', 'docs/g/README.md': '- [B](b.md)\n', 'docs/g/b.md': '# B\n' };
  const withNote = (a: string) => run({ ...base, 'docs/f/README.md': '- [A](a.md)\n', 'docs/f/a.md': a });

  it('accepts working links, wikilinks, aliases, headings and the own-folder README', () => {
    expect(withNote('# A\n## Parte\n[b](../g/b.md) [[b]] [[b|otra]] [[a#Parte]] [[README]] `[[ejemplo]]`\n').out).toContain('check-docs: PASS');
  });

  it('reports a broken markdown link in a note', () => {
    expect(withNote('[b](../g/gone.md)\n').out).toContain('docs/f/a.md: broken link ../g/gone.md');
  });

  it('reports a wikilink to a renamed or missing note', () => {
    expect(withNote('[[gone]]\n').out).toContain('docs/f/a.md: broken wikilink [[gone]]');
  });

  it('reports a wikilink whose name exists in several folders and not in its own', () => {
    const r = run({ ...base, 'docs/h/README.md': '- [B](b.md)\n', 'docs/h/b.md': '# B\n', 'docs/README.md': '- [F](f/README.md)\n- [G](g/README.md)\n- [H](h/README.md)\n', 'docs/f/README.md': '- [A](a.md)\n', 'docs/f/a.md': '[[b]]\n' });
    expect(r.out).toContain('docs/f/a.md: ambiguous wikilink [[b]]');
  });

  it('reports a wikilink to a missing heading', () => {
    expect(withNote('# A\n[[b#Nada]]\n').out).toContain('docs/f/a.md: wikilink [[b#Nada]] names a missing heading');
  });
});
