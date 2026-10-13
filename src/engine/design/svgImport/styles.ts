/*
 * Computed style of an SVG element: presentation attributes, then <style> rules (class, id, tag and compound
 * selectors, by specificity and order), then the style="" attribute, with inheritance. Descendant or attribute
 * selectors are not evaluated: the rule is skipped and counted so the report can say so.
 */

export type Style = Record<string, string>;

const INHERITED = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'paint-order', 'color', 'visibility', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-anchor', 'marker-start', 'marker-mid', 'marker-end'];
const OWN = ['opacity', 'display', 'filter', 'clip-path', 'mask', 'mix-blend-mode', 'isolation'];
const PROPS = new Set([...INHERITED, ...OWN]);

interface Rule { tag: string | null; ids: string[]; classes: string[]; spec: number; order: number; decls: Style }
export interface Sheet { rules: Rule[]; skipped: number }

/** `a:b; c:d` splitting only on semicolons outside parentheses and quotes (a data: URL holds semicolons). */
export function declarations(text: string): Style {
  const out: Style = {};
  let depth = 0, quote = '', cur = '';
  const flush = () => {
    const i = cur.indexOf(':');
    if (i > 0) { const k = cur.slice(0, i).trim().toLowerCase(), v = cur.slice(i + 1).replace(/!important\s*$/i, '').trim(); if (k && v) out[k] = v; }
    cur = '';
  };
  for (const ch of text) {
    if (quote) { if (ch === quote) quote = ''; cur += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) { flush(); continue; }
    cur += ch;
  }
  flush();
  return out;
}

export function parseSheets(root: Element): Sheet {
  const sheet: Sheet = { rules: [], skipped: 0 };
  let order = 0;
  for (const el of Array.from(root.getElementsByTagName('style'))) {
    const css = (el.textContent ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    const re = /([^{}@]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css))) {
      const decls = declarations(m[2]);
      for (const sel of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        const parts = sel.match(/^(\*|[A-Za-z][\w-]*)?((?:[.#][\w-]+)*)$/);
        if (!parts) { sheet.skipped++; continue; }
        const marks = parts[2].match(/[.#][\w-]+/g) ?? [];
        const ids = marks.filter((x) => x[0] === '#').map((x) => x.slice(1)), classes = marks.filter((x) => x[0] === '.').map((x) => x.slice(1));
        sheet.rules.push({ tag: parts[1] && parts[1] !== '*' ? parts[1].toLowerCase() : null, ids, classes, spec: ids.length * 100 + classes.length * 10 + (parts[1] && parts[1] !== '*' ? 1 : 0), order: order++, decls });
      }
    }
  }
  return sheet;
}

function matches(el: Element, r: Rule): boolean {
  if (r.tag && el.localName.toLowerCase() !== r.tag) return false;
  if (r.ids.some((id) => el.getAttribute('id') !== id)) return false;
  const cls = (el.getAttribute('class') ?? '').split(/\s+/);
  return r.classes.every((c) => cls.includes(c));
}

/** The element's style given its parent's computed style. */
export function computeStyle(el: Element, sheet: Sheet, parent: Style): Style {
  const own: Style = {};
  for (const a of Array.from(el.attributes)) if (PROPS.has(a.name)) own[a.name] = a.value.trim();
  for (const r of sheet.rules.filter((x) => matches(el, x)).sort((a, b) => a.spec - b.spec || a.order - b.order)) Object.assign(own, r.decls);
  const inline = el.getAttribute('style');
  if (inline) Object.assign(own, declarations(inline));
  const out: Style = {};
  for (const k of INHERITED) if (parent[k] !== undefined) out[k] = parent[k];
  for (const [k, v] of Object.entries(own)) {
    if (!PROPS.has(k)) continue;
    if (v === 'inherit') { if (parent[k] !== undefined) out[k] = parent[k]; } else out[k] = v;
  }
  return out;
}

// ---- values ---------------------------------------------------------------------------------------------------

const NAMED: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', lime: '#00ff00', blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff', gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000', olive: '#808000', green: '#008000', purple: '#800080', teal: '#008080', navy: '#000080', orange: '#ffa500' };
const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');

export type Paint = { kind: 'none' } | { kind: 'color'; color: string; alpha: number } | { kind: 'ref'; id: string };

/** A fill or stroke value as a #rrggbb colour (with its own alpha), none, or a reference to a paint server. */
export function parsePaint(value: string | undefined, currentColor = '#000000'): Paint {
  const v = (value ?? '').trim();
  if (!v) return { kind: 'none' };
  const lower = v.toLowerCase();
  if (lower === 'none' || lower === 'transparent') return { kind: 'none' };
  const ref = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/i.exec(v);
  if (ref) return { kind: 'ref', id: ref[1] };
  if (lower === 'currentcolor') return parsePaint(currentColor, '#000000');
  let m = /^#([0-9a-f]{3,4})$/i.exec(v);
  if (m) { const h = m[1]; const c = '#' + h.slice(0, 3).split('').map((x) => x + x).join(''); return { kind: 'color', color: c.toLowerCase(), alpha: h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1 }; }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v);
  if (m) return { kind: 'color', color: '#' + m[1].toLowerCase(), alpha: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  m = /^rgba?\(\s*([^)]+)\)$/i.exec(v);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    const ch = (s: string) => (s.endsWith('%') ? (parseFloat(s) * 255) / 100 : parseFloat(s));
    if (p.length >= 3 && p.slice(0, 3).every((s) => Number.isFinite(ch(s)))) {
      const a = p[3] === undefined ? 1 : p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
      return { kind: 'color', color: `#${hex2(ch(p[0]))}${hex2(ch(p[1]))}${hex2(ch(p[2]))}`, alpha: Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 1 };
    }
  }
  if (lower in NAMED) return { kind: 'color', color: NAMED[lower], alpha: 1 };
  // Any other colour name (or hsl(), etc.): the canvas and SVG understand it as written.
  return /^[a-z]+$/i.test(v) || /^(hsla?)\(/i.test(v) ? { kind: 'color', color: lower, alpha: 1 } : { kind: 'none' };
}

/** A 0–1 number (or a percentage); `fallback` when absent or not a number. */
export function parseOpacity(value: string | undefined, fallback = 1): number {
  const v = (value ?? '').trim();
  if (!v) return fallback;
  const n = v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}
