import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Reads src/styles/tokens.css + accents.css and resolves the tokens for an <html> with data-base / data-accent,
// with a small cascade (specificity, then source order) and var() resolution. No browser needed.
const read = (f: string) => readFileSync(`src/styles/${f}`, 'utf8');

type Rule = { selectors: string[]; decls: Record<string, string>; order: number };
function splitTop(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = '', cur = '';
  for (const ch of text) {
    if (quote) { if (ch === quote) quote = ''; cur += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
function parse(css: string, startOrder = 0): Rule[] {
  const rules: Rule[] = [];
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*(?:\([^)]*\)[^{}]*)*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const decls: Record<string, string> = {};
    for (const d of splitTop(m[2], ';')) {
      const i = d.indexOf(':');
      const name = d.slice(0, i).trim();
      if (name.startsWith('--')) decls[name] = d.slice(i + 1).trim();
    }
    if (Object.keys(decls).length) rules.push({ selectors: splitTop(m[1], ',').map((s) => s.trim()), decls, order: startOrder + rules.length });
  }
  return rules;
}
/** Specificity of a selector made of html / :root / [data-x="y"] / :not([data-x]); null if it does not match the element. */
function match(sel: string, el: Record<string, string>): number | null {
  let spec = 0;
  const rest = sel.replace(/:not\(\[(data-\w+)\]\)/g, (_, k) => (spec += 10, el[k] === undefined ? '' : '\u0000')).replace(/\[(data-\w+)="([\w-]+)"\]/g, (_, k, v) => (spec += 10, el[k] === v ? '' : '\u0000'));
  const bare = rest.replace(/^html/, () => (spec += 1, '')).replace(/^:root/, () => (spec += 10, ''));
  return bare === '' ? spec : null;
}
function resolve(rules: Rule[], el: Record<string, string>): Record<string, string> {
  const hits: { spec: number; order: number; decls: Record<string, string> }[] = [];
  for (const r of rules) {
    const specs = r.selectors.map((s) => match(s, el)).filter((s): s is number => s !== null);
    if (specs.length) hits.push({ spec: Math.max(...specs), order: r.order, decls: r.decls });
  }
  hits.sort((a, b) => a.spec - b.spec || a.order - b.order);
  const raw: Record<string, string> = {};
  for (const h of hits) Object.assign(raw, h.decls);
  const val = (v: string, depth = 0): string => (depth > 8 ? v : v.replace(/var\((--[\w-]+)(?:,\s*([^)]*))?\)/g, (_, n, fb) => (raw[n] !== undefined ? val(raw[n], depth + 1) : fb ?? '')));
  return Object.fromEntries(Object.keys(raw).map((k) => [k, val(raw[k])]));
}

const tokens = parse(read('tokens.css'));
const rules = [...tokens, ...parse(read('accents.css'), tokens.length)];
const BASES = ['atlas', 'grafito', 'claro', 'blanco', 'original'];
const ACCENTS = ['lima', 'azul', 'violeta', 'rosa', 'agua', 'aurora'];
const themeOf = (base: string, accent: string) => resolve(rules, { 'data-base': base, 'data-accent': accent });

function lum(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** A hex or rgba() colour flattened onto a hex background (Original's selection fill is the translucent accent-soft). */
function flat(c: string, bg: string): string {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(c);
  if (!m) return c;
  const a = Number(m[4]);
  return '#' + [0, 2, 4].map((i, n) => Math.round(Number(m[n + 1]) * a + parseInt(bg.slice(1 + i, 3 + i), 16) * (1 - a)).toString(16).padStart(2, '0')).join('');
}
const hexes = (v: string) => v.match(/#[0-9a-fA-F]{6}\b/g) ?? [];

describe('theme tokens: contrast (WCAG >= 4.5) for every base x accent', () => {
  for (const base of BASES) for (const accent of ACCENTS) {
    it(`${base} + ${accent}`, () => {
      const t = themeOf(base, accent);
      for (const k of ['--surface', '--bg-canvas', '--text', '--text-2', '--text-3', '--accent', '--accent-ink', '--select-on']) {
        expect(t[k], `${k} is a hex colour`).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
      for (const text of ['--text', '--text-2', '--text-3']) {
        for (const ground of ['--surface', '--bg-canvas']) {
          expect(ratio(t[text], t[ground]), `${text} on ${ground}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      // Primary ink on its fill: the flat accent and, in Aurora, every gradient stop.
      for (const fill of [t['--accent'], ...hexes(t['--accent-grad'] ?? '')]) {
        expect(ratio(t['--accent-ink'], fill), `ink on ${fill}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio(t['--accent'], t['--surface']), 'accent on surface').toBeGreaterThanOrEqual(4.5);
      expect(ratio(t['--select-on'], flat(t['--select-on-soft'], t['--surface'])), 'chosen text on chosen fill').toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('theme tokens: bases, radii and accents', () => {
  it('Atlas is the default :root and lima the default accent', () => {
    const t = resolve(rules, {});
    expect(t['--bg-canvas']).toBe('#131314');
    expect(t['--surface']).toBe('#1e1f20');
    expect(t['--accent']).toBe('#d8ff3a');
    expect(t['--btn-radius']).toBe('999px');
    expect(t['--chip-radius']).toBe('999px');
  });
  it('Grafito and Claro carry the approved neutrals', () => {
    expect(themeOf('grafito', 'lima')['--bg-canvas']).toBe('#1a1a1e');
    const claro = themeOf('claro', 'lima');
    expect([claro['--bg-canvas'], claro['--surface'], claro['--accent']]).toEqual(['#f1efec', '#fbfaf8', '#4f6b00']);
    // Blanco: white page, blue-grey panels, and the same light highlight sets as Claro.
    const blanco = themeOf('blanco', 'azul');
    expect([blanco['--bg-canvas'], blanco['--surface'], blanco['--accent']]).toEqual(['#ffffff', '#f0f4f9', themeOf('claro', 'azul')['--accent']]);
  });
  it('only Aurora has the gradient and the grain', () => {
    for (const base of BASES) for (const accent of ACCENTS) {
      const t = themeOf(base, accent);
      expect(Boolean(t['--accent-grad']) && Boolean(t['--grain']), `${base}+${accent}`).toBe(accent === 'aurora');
    }
  });
  it('defines the card and popover tokens', () => {
    const t = resolve(rules, {});
    for (const k of ['--card-w-s', '--card-w-m', '--card-w-l', '--card-pad-s', '--card-pad-m', '--card-pad-l', '--card-radius', '--fs-title', '--pop-bg', '--pop-radius', '--pop-pad', '--pop-shadow']) {
      expect(t[k], k).toBeTruthy();
    }
  });
});

// tokens.css and the lima accent as they were before the bases existed (git 34d031f), resolved.
const TODAY: Record<string, string> = {
  '--bg': '#0a0a0b', '--bg-canvas': '#0d0d0f', '--surface': '#151518', '--surface-2': '#1d1d21', '--surface-3': '#28282d', '--surface-hover': '#232328',
  '--overlay': 'rgba(6, 6, 8, 0.72)', '--border': '#2a2a30', '--border-strong': '#3a3a42', '--border-focus': '#575761',
  '--text': '#ececf0', '--text-2': '#c3c3cb', '--text-3': '#8e8e98', '--text-4': '#61616a',
  '--accent': '#d8ff3a', '--accent-soft': 'rgba(216, 255, 58, 0.14)', '--accent-line': 'rgba(216, 255, 58, 0.45)', '--accent-ink': '#0b0c05',
  '--danger': '#f06a6a', '--danger-soft': 'rgba(240, 106, 106, 0.12)', '--warn': '#ffc25e', '--ok': '#86e3a5',
  '--type-text': '#c3c3cb', '--type-image': '#9cc4ff', '--type-video': '#d2b4ff', '--type-audio': '#8ce6c4',
  '--radius-xs': '5px', '--radius-s': '7px', '--radius': '10px', '--radius-l': '14px', '--radius-xl': '18px',
  '--r-s': '6px', '--r-m': '16px', '--r-l': '24px', '--r-full': '999px',
  '--fs-xs': '11px', '--fs-s': '12px', '--fs-m': '13px', '--fs-l': '15px', '--fs-xl': '20px',
  '--sp-1': '4px', '--sp-2': '8px', '--sp-3': '12px', '--sp-4': '16px', '--sp-5': '24px',
  '--control-h': '32px', '--control-icon': '18px', '--control-gap': '6px', '--toolbar-padding': '6px', '--toolbar-radius': '12px',
  '--slider-track-h': '4px', '--slider-thumb': '14px',
  '--shadow-pop': '0 18px 48px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.35)',
  '--shadow-card': '0 1px 0 rgba(255, 255, 255, 0.02) inset, 0 8px 24px rgba(0, 0, 0, 0.25)',
  '--sidebar-w': '56px', '--topbar-h': '48px', '--ease': 'cubic-bezier(0.2, 0.7, 0.2, 1)',
};
describe('theme tokens: Original is today', () => {
  it('resolves every token the app had to the same value (with the lima accent)', () => {
    const t = themeOf('original', 'lima');
    for (const [k, v] of Object.entries(TODAY)) expect(t[k], k).toBe(v);
  });
  it('keeps today\'s corners on buttons (radius-s) and chips (10px), and selection equals the plain accent', () => {
    const t = themeOf('original', 'lima');
    expect(t['--btn-radius']).toBe(TODAY['--radius-s']);
    expect(t['--chip-radius']).toBe('10px');
    expect([t['--select-on'], t['--select-on-soft'], t['--select-line']]).toEqual([t['--accent'], t['--accent-soft'], t['--accent-line']]);
  });
});
