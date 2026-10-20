import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// index.html carries a tiny inline script that sets data-base / data-accent on <html> before first paint.
// It reads only localStorage (UI preference, never the persisted settings or the store).
const html = readFileSync('index.html', 'utf8');
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];

type Env = { stored?: Record<string, string>; light?: boolean; storageThrows?: boolean; mediaThrows?: boolean };
function run(env: Env = {}) {
  if (!script) throw new Error('index.html has no inline pre-paint script');
  const attrs: Record<string, string> = {};
  const document = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } };
  const reads: string[] = [];
  const localStorage = {
    getItem: (k: string) => {
      reads.push(k);
      if (env.storageThrows) throw new Error('blocked');
      return env.stored?.[k] ?? null;
    },
    setItem: () => { throw new Error('the script must not write'); },
  };
  const matchMedia = (q: string) => {
    if (env.mediaThrows) throw new Error('no matchMedia');
    return { matches: q === '(prefers-color-scheme: light)' && !!env.light };
  };
  new Function('document', 'localStorage', 'matchMedia', script)(document, localStorage, matchMedia);
  return { attrs, reads };
}

describe('pre-paint theme script', () => {
  it('is an inline script ahead of the app module, reading only the two UI keys', () => {
    expect(script).toBeTruthy();
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('/src/main.tsx'));
    expect(run({ stored: { 'ogs-base': 'claro' } }).reads.sort()).toEqual(['ogs-accent', 'ogs-base']);
    expect(script).not.toMatch(/ogs-state|setItem|indexedDB/);
  });

  it('uses atlas + lima with no stored value', () => {
    expect(run().attrs).toEqual({ 'data-base': 'atlas', 'data-accent': 'lima' });
  });

  it.each(['atlas', 'grafito', 'claro', 'blanco', 'original'])('maps base %s to itself', (base) => {
    expect(run({ stored: { 'ogs-base': base } }).attrs['data-base']).toBe(base);
  });

  it.each(['lima', 'azul', 'violeta', 'rosa', 'agua', 'aurora'])('maps accent %s to itself', (accent) => {
    expect(run({ stored: { 'ogs-accent': accent } }).attrs['data-accent']).toBe(accent);
  });

  it('resolves sistema through prefers-color-scheme: light to claro, otherwise atlas', () => {
    expect(run({ stored: { 'ogs-base': 'sistema' }, light: true }).attrs['data-base']).toBe('claro');
    expect(run({ stored: { 'ogs-base': 'sistema' }, light: false }).attrs['data-base']).toBe('atlas');
  });

  it('falls back on garbage, and each key falls back on its own', () => {
    expect(run({ stored: { 'ogs-base': 'neon', 'ogs-accent': '#ff0000' } }).attrs).toEqual({ 'data-base': 'atlas', 'data-accent': 'lima' });
    expect(run({ stored: { 'ogs-base': 'Claro', 'ogs-accent': 'azul' }, light: true }).attrs).toEqual({ 'data-base': 'atlas', 'data-accent': 'azul' });
    expect(run({ stored: { 'ogs-base': 'grafito', 'ogs-accent': 'pink' } }).attrs).toEqual({ 'data-base': 'grafito', 'data-accent': 'lima' });
  });

  it('falls back when localStorage or matchMedia throws, and never throws itself', () => {
    expect(run({ storageThrows: true }).attrs).toEqual({ 'data-base': 'atlas', 'data-accent': 'lima' });
    expect(run({ stored: { 'ogs-base': 'sistema', 'ogs-accent': 'rosa' }, mediaThrows: true }).attrs).toEqual({ 'data-base': 'atlas', 'data-accent': 'rosa' });
  });
});
