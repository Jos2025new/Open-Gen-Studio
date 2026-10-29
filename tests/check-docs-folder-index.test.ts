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
