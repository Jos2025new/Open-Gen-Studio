import type { GradientPaint, GradientStop } from '../../shapeSpec';
import { apply, IDENTITY, type Mat } from '../matrix';
import { parsePaint } from './styles';
import { parseLength, parseTransform } from './transforms';
import type { ShapeCtx } from './shapes';

/*
 * An SVG gradient the editor can hold: linear or radial, userSpaceOnUse, pad spread, the stops of the element or of the
 * gradients it inherits from (xlink:href), and a gradientTransform. Points come out in page coordinates. Anything
 * else (objectBoundingBox, reflect/repeat, a moved focus, a skewed radial) returns null and the element is rasterized.
 */

const uniform = (m: Mat) => Math.abs(Math.hypot(m[0], m[1]) - Math.hypot(m[2], m[3])) < 1e-6 && Math.abs(m[0] * m[2] + m[1] * m[3]) < 1e-6;

function chainOf(el: Element, ids: Map<string, Element>): Element[] {
  const out: Element[] = [];
  let cur: Element | undefined = el;
  while (cur && !out.includes(cur) && /gradient$/i.test(cur.localName)) {
    out.push(cur);
    const href: string = cur.getAttribute('href') ?? cur.getAttribute('xlink:href') ?? '';
    cur = href.startsWith('#') ? ids.get(href.slice(1)) : undefined;
  }
  return out;
}

function stopsOf(chain: Element[]): GradientStop[] | null {
  const owner = chain.find((e) => Array.from(e.children).some((ch) => ch.localName === 'stop'));
  if (!owner) return null;
  const out: GradientStop[] = [];
  for (const st of Array.from(owner.children).filter((ch) => ch.localName === 'stop')) {
    const style = st.getAttribute('style') ?? '';
    const pick = (name: string) => new RegExp(`${name}\\s*:\\s*([^;]+)`).exec(style)?.[1]?.trim() ?? st.getAttribute(name) ?? undefined;
    const off = (st.getAttribute('offset') ?? '0').trim();
    const offset = off.endsWith('%') ? parseFloat(off) / 100 : parseFloat(off);
    const colour = parsePaint(pick('stop-color') ?? '#000000');
    if (colour.kind !== 'color' || !Number.isFinite(offset)) return null;
    const op = parseFloat(pick('stop-opacity') ?? '1');
    out.push({ offset: Math.min(1, Math.max(0, offset)), color: colour.color, alpha: colour.alpha * (Number.isFinite(op) ? Math.min(1, Math.max(0, op)) : 1) });
  }
  return out.length ? out : null;
}

/** The gradient a `url(#id)` paint refers to, in page coordinates, or null when it has to be rasterized. */
export function importGradient(id: string, c: ShapeCtx): GradientPaint | null {
  const el = c.ids.get(id);
  if (!el || !/gradient$/i.test(el.localName)) return null;
  const chain = chainOf(el, c.ids);
  const attr = (name: string) => chain.map((e) => e.getAttribute(name)).find((v) => v != null) ?? null;
  if (attr('gradientUnits') !== 'userSpaceOnUse') return null;
  const spread = attr('spreadMethod');
  if (spread && spread !== 'pad') return null;
  const gt = attr('gradientTransform');
  const G: Mat = gt ? parseTransform(gt) : IDENTITY;
  const len = (name: string, ref: number, fallback: string) => parseLength(attr(name) ?? fallback, ref, c.fontSize) ?? 0;
  const diag = Math.hypot(c.vw, c.vh) / Math.SQRT2;
  const stops = stopsOf(chain);
  if (!stops) return null;
  const toPage = (x: number, y: number): [number, number] => apply(c.ctm, ...apply(G, x, y));

  if (el.localName.startsWith('linear') || /^linear/i.test(chain[chain.length - 1].localName)) {
    const p1 = toPage(len('x1', c.vw, '0'), len('y1', c.vh, '0'));
    const p2 = toPage(len('x2', c.vw, '100%'), len('y2', c.vh, '0'));
    return { kind: 'linear', x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], stops };
  }
  // Radial: a moved focus or a skewed transform would bend the circle, so those are rasterized.
  const cx = len('cx', c.vw, '50%'), cy = len('cy', c.vh, '50%'), r = len('r', diag, '50%');
  const fx = attr('fx'), fy = attr('fy');
  if ((fx != null && Math.abs(len('fx', c.vw, '0') - cx) > 1e-9) || (fy != null && Math.abs(len('fy', c.vh, '0') - cy) > 1e-9)) return null;
  const full: Mat = [c.ctm[0], c.ctm[1], c.ctm[2], c.ctm[3], 0, 0];
  if (!uniform(G) || !uniform(full) || !(r > 0)) return null;
  const p1 = toPage(cx, cy), p2 = toPage(cx + r, cy);
  return { kind: 'radial', x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], stops };
}
