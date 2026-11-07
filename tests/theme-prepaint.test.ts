// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TEXT_SCALES } from '../src/lib/theme';

// index.html carries a tiny inline script that sets data-base / data-accent on <html> before first paint.
// It reads only localStorage (UI preference, never the persisted settings or the store).
const html = readFileSync('index.html', 'utf8');
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];

type Env = { stored?: Record<string, string>; light?: boolean; reduced?: boolean; storageThrows?: boolean; mediaThrows?: boolean };
function run(env: Env = {}) {
  if (!script) throw new Error('index.html has no inline pre-paint script');
  // Runs in jsdom against the real <html>; localStorage and matchMedia are the script's parameters (stubs, so nothing is written).
  const root = document.documentElement;
  for (const a of [...root.attributes]) root.removeAttribute(a.name);
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
    return { matches: (q === '(prefers-color-scheme: light)' && !!env.light) || (q === '(prefers-reduced-motion: reduce)' && !!env.reduced) };
  };
  new Function('document', 'localStorage', 'matchMedia', script)(document, localStorage, matchMedia);
  const attrs = Object.fromEntries([...root.attributes].map((a) => [a.name, a.value]));
  return { attrs, reads, root };
}

describe('pre-paint theme script', () => {
  it('is an inline script ahead of the app module, reading only the UI keys (base, accent, contrast)', () => {
    expect(script).toBeTruthy();
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('/src/main.tsx'));
    expect(run({ stored: { 'ogs-base': 'claro' } }).reads.sort()).toEqual(['ogs-accent', 'ogs-base', 'ogs-contrast', 'ogs-focus', 'ogs-motion', 'ogs-text-scale']);
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

  it('applies contrast high, the text scale, reduce motion and strong focus to the real root', () => {
    const { root, attrs } = run({ stored: { 'ogs-contrast': 'high', 'ogs-text-scale': '1.5', 'ogs-motion': 'on', 'ogs-focus': 'on' } });
    expect(attrs['data-contrast']).toBe('high');
    expect(attrs['data-text-scale']).toBe('1.5');
    expect(root.style.getPropertyValue('--text-scale')).toBe('1.5');
    expect(root.classList.contains('reduce-motion')).toBe(true);
    expect(root.classList.contains('focus-strong')).toBe(true);
    expect(run({ stored: { 'ogs-contrast': 'soft' } }).attrs['data-contrast']).toBe('soft');
    expect(run({ stored: { 'ogs-text-scale': '3.3', 'ogs-contrast': 'bogus' } }).attrs['data-text-scale']).toBeUndefined();
  });

  it('follows the OS reduce-motion setting until the user chooses; an explicit off wins', () => {
    expect(run({ reduced: true }).root.classList.contains('reduce-motion')).toBe(true);
    const off = run({ reduced: true, stored: { 'ogs-motion': 'off' } });
    expect(off.root.classList.contains('reduce-motion')).toBe(false);
    expect(off.attrs['data-motion']).toBe('full');
    expect(run({ reduced: false }).root.classList.contains('reduce-motion')).toBe(false);
  });

  it('its text-scale whitelist is exactly TEXT_SCALES (minus 1, which is the default)', () => {
    const list = /\[([\d.,\s]+)\]\.indexOf\(t\)/.exec(script ?? '')?.[1].split(',').map((n) => Number(n.trim()));
    expect(list).toEqual(TEXT_SCALES.filter((n) => n !== 1));
  });
});
