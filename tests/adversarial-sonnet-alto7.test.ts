// Adversarial review of task/alto-7 (a1126d14..HEAD). Each `it.fails` documents a gap: it passes while the gap exists
// and turns red (so it must be flipped to `it`) when the gap is closed.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { check as mediaLiterals } from '../scripts/check-media-literals.mjs';
import { check as testDiscovery } from '../scripts/check-test-discovery.mjs';
import { checkSizes } from '../scripts/check-sizes.mjs';

const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

function srcRoot(code: string, file = 'src/x.ts'): string {
  const root = mkdtempSync(join(tmpdir(), 'adv7-'));
  roots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, file), code);
  return root;
}

describe('check-media-literals: forms it must catch (sanity: these pass today)', () => {
  for (const [name, code] of Object.entries({
    multiline: "export const A = [\n 'image',\n 'video',\n];",
    asConst: "export const A = ['image', 'video', 'audio'] as const;",
    set: "export const A = new Set(['image', 'video', 'audio']);",
    zenum: "import { z } from 'zod'; export const A = z.enum(['image', 'video']);",
    zunion: "import { z } from 'zod'; export const A = z.union([z.literal('image'), z.literal('video')]);",
  })) {
    it(`catches ${name}`, () => { expect(mediaLiterals(srcRoot(code))).not.toHaveLength(0); });
  }
});

describe('check-media-literals: bypasses (MEDIUM, inherited design, new check)', () => {
  // The real repo already has one: src/engine/placeTypes.ts:4 `type Mode = 'image' | 'video' | 'audio' | 'model3d' | 'agent'`.
  it.fails('catches a TS union type that restates the media kinds', () => {
    expect(mediaLiterals(srcRoot("export type M = 'image' | 'video' | 'audio' | 'model3d';"))).not.toHaveLength(0);
  });
  it.fails('catches a template-literal list', () => {
    expect(mediaLiterals(srcRoot('export const A = [`image`, `video`, `audio`];'))).not.toHaveLength(0);
  });
  it.fails('catches an object keyed by the kinds', () => {
    expect(mediaLiterals(srcRoot('export const A = { image: 1, video: 2, audio: 3 };'))).not.toHaveLength(0);
  });
  it.fails('an exempt binding name does not hide a nested media list (EXCEPTIONS are by name, any depth)', () => {
    const root = srcRoot("export const ROUTE_ORDER = { later: ['image', 'video', 'audio'] };", 'src/engine/variants.ts');
    expect(mediaLiterals(root)).not.toHaveLength(0);
  });
  it.fails('also scans .js/.jsx/.mjs sources under src/', () => {
    expect(mediaLiterals(srcRoot("export const A = ['image', 'video', 'audio'];", 'src/x.mjs'))).not.toHaveLength(0);
  });
});

describe('check-test-discovery: dead tests it does not see (MEDIUM, new check)', () => {
  const viteConfig = readFileSync('vite.config.ts', 'utf8');
  const rootWith = (files: string[]) => {
    const root = mkdtempSync(join(tmpdir(), 'adv7-td-'));
    roots.push(root);
    writeFileSync(join(root, 'vite.config.ts'), viteConfig);
    for (const f of files) { mkdirSync(join(root, f, '..'), { recursive: true }); writeFileSync(join(root, f), ''); }
    return root;
  };
  it('catches a .test.tsx in a new folder only if vitest would skip it (sanity: matched, no error)', () => {
    expect(testDiscovery(rootWith(['tests/new/deep/a.test.tsx']))).toEqual([]);
  });
  it('catches a .test.mts / .test.js under tests/ (sanity)', () => {
    expect(testDiscovery(rootWith(['tests/b.test.mts', 'tests/e.test.js']))).toHaveLength(2);
  });
  it.fails('catches a *.spec.ts under tests/ (never runs: include only lists *.test.ts[x])', () => {
    expect(testDiscovery(rootWith(['tests/c.spec.ts']))).not.toHaveLength(0);
  });
  it.fails('catches a *.test.ts outside tests/ (src/, spike/: vitest never includes it; spike/sqlite/*.test.ts exists today)', () => {
    expect(testDiscovery(rootWith(['src/d.test.ts']))).not.toHaveLength(0);
  });
});

describe('check-sizes: baseline ratchet (LOW-MEDIUM, new)', () => {
  const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...a], { cwd, stdio: 'pipe' });
  function repo(bytes: number, baseline: number) {
    const root = mkdtempSync(join(tmpdir(), 'adv7-sz-'));
    roots.push(root);
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'big.ts'), 'x'.repeat(bytes));
    writeFileSync(join(root, 'scripts/size-baseline.json'), JSON.stringify({ 'big.ts': baseline }));
    git(root, 'init', '-q'); git(root, 'add', '-A'); git(root, 'commit', '-qm', 'base');
    return root;
  }
  it('fails when a baselined file grows (sanity)', () => {
    const root = repo(31_000, 31_000);
    writeFileSync(join(root, 'big.ts'), 'x'.repeat(31_500));
    expect(() => checkSizes(root)).toThrow(/grew from/);
  });
  it.fails('fails when the baseline is raised by hand together with the file (nothing compares it to the committed baseline)', () => {
    const root = repo(31_000, 31_000);
    writeFileSync(join(root, 'big.ts'), 'x'.repeat(40_000));
    writeFileSync(join(root, 'scripts/size-baseline.json'), JSON.stringify({ 'big.ts': 40_000 }));
    expect(() => checkSizes(root)).toThrow();
  });
  it.fails('fails when a brand-new over-limit file is added to the baseline by hand', () => {
    const root = repo(31_000, 31_000);
    writeFileSync(join(root, 'new.ts'), 'x'.repeat(35_000));
    writeFileSync(join(root, 'scripts/size-baseline.json'), JSON.stringify({ 'big.ts': 31_000, 'new.ts': 35_000 }));
    expect(() => checkSizes(root)).toThrow();
  });
  it.fails('a file at 99% of the limit is more than a warning (only stderr noise: 56 files warn today)', () => {
    const root = repo(10, 10);
    writeFileSync(join(root, 'scripts/size-baseline.json'), '{}');
    writeFileSync(join(root, 'big.ts'), 'x'.repeat(29_900));
    expect(() => checkSizes(root)).toThrow();
  });
});

describe('tools.ts confirm_settings kinds (LOW, new)', () => {
  it.fails('does not hide a drift behind a tuple cast of a reversed copy', () => {
    const text = readFileSync('src/engine/agent/tools.ts', 'utf8');
    expect(text).not.toMatch(/\.reverse\(\) as \[/);
  });
});
