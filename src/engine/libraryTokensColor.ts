import { hslHex, rgbHex } from '../lib/color';

/* Colors of token files: the W3C object ({ colorSpace, components, alpha, hex }) and the CSS text this app keeps. */
export interface TokenColor { colorSpace: string; components: number[]; alpha?: number; hex?: string; }
const FUNCTIONS = ['oklch', 'oklab', 'lab', 'lch'];
const SPACES = ['srgb-linear', 'display-p3', 'a98-rgb', 'prophoto-rgb', 'rec2020', 'xyz-d65', 'xyz-d50'];
const round = (n: number, d = 4) => Number(n.toFixed(d));
const alphaHex = (a: number) => (a >= 1 ? '' : Math.round(Math.max(0, a) * 255).toString(16).padStart(2, '0'));

/** A W3C color object as CSS text; undefined when it is not one. */
export function colorText(raw: Record<string, unknown>): string | undefined {
  const c = Array.isArray(raw.components) ? raw.components.map((v) => (v === 'none' ? 0 : v)) : [], a = raw.alpha ?? 1, space = String(raw.colorSpace);
  if (typeof a !== 'number' || !Number.isFinite(a)) return undefined;
  if (c.length === 3 && c.every((v): v is number => typeof v === 'number' && Number.isFinite(v))) {
    if (space === 'srgb') return rgbHex(c.map((v) => v * 255)) + alphaHex(a);
    if (space === 'hsl') return hslHex([((c[0] % 360) + 360) % 360, c[1], c[2]]) + alphaHex(a);
    const tail = a < 1 ? ` / ${a}` : '';
    if (FUNCTIONS.includes(space)) return `${space}(${c.join(' ')}${tail})`;
    if (SPACES.includes(space)) return `color(${space} ${c.join(' ')}${tail})`;
  }
  return typeof raw.hex === 'string' ? raw.hex + (raw.hex.length === 7 ? alphaHex(a) : '') : undefined;
}

/** CSS color text as the W3C object; undefined for what it cannot say exactly (other color names, mixed units). */
export function colorObject(text: string): TokenColor | undefined {
  let t = text.trim().toLowerCase();
  t = { transparent: '#00000000', black: '#000000', white: '#ffffff' }[t] ?? t;
  if (/^#[0-9a-f]{3,4}$/.test(t)) t = `#${[...t.slice(1)].map((x) => x + x).join('')}`;
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(t);
  if (hex) return { colorSpace: 'srgb', components: [0, 2, 4].map((i) => round(parseInt(hex[1].slice(i, i + 2), 16) / 255)), alpha: hex[2] ? round(parseInt(hex[2], 16) / 255) : 1, hex: `#${hex[1]}` };
  const fn = /^([a-z]+)\(([^()]+)\)$/.exec(t);
  if (!fn) return undefined;
  const parts = fn[2].split(/[\s,/]+/).filter(Boolean), space = fn[1] === 'color' ? parts.shift() ?? '' : { rgba: 'rgb', hsla: 'hsl' }[fn[1]] ?? fn[1];
  // What 100% of each component means in that space.
  const full = space === 'rgb' ? [255, 255, 255] : space === 'hsl' ? [NaN, 100, 100] : space === 'lab' ? [100, 125, 125] : space === 'lch' ? [100, 150, NaN] : space === 'oklab' ? [1, 0.4, 0.4] : space === 'oklch' ? [1, 0.4, NaN] : [1, 1, 1];
  const n = parts.map((p, i) => (/^-?(\d+\.?\d*|\.\d+)(e-?\d+)?(%|deg)?$/.test(p) ? (p.endsWith('%') ? (parseFloat(p) / 100) * (full[i] ?? 1) : parseFloat(p)) : p === 'none' ? 0 : NaN));
  if (n.length < 3 || n.length > 4 || n.some((v) => !Number.isFinite(v))) return undefined;
  const [components, alpha] = [n.slice(0, 3), Math.max(0, Math.min(1, n[3] ?? 1))];
  if (space === 'rgb') return { colorSpace: 'srgb', components: components.map((v) => round(v / 255)), alpha, hex: rgbHex(components) };
  if (space === 'hsl') return { colorSpace: 'hsl', components, alpha, hex: hslHex([((components[0] % 360) + 360) % 360, components[1], components[2]]) };
  return FUNCTIONS.includes(space) || SPACES.includes(space) || space === 'srgb' ? { colorSpace: space, components, alpha } : undefined;
}

/** CSS color text as hex, the only way Penpot writes it; undefined outside sRGB. */
export function colorHex(text: string): string | undefined {
  const c = colorObject(text);
  return c?.hex ? c.hex + alphaHex(c.alpha ?? 1) : c?.colorSpace === 'srgb' ? rgbHex(c.components.map((v) => v * 255)) + alphaHex(c.alpha ?? 1) : undefined;
}
