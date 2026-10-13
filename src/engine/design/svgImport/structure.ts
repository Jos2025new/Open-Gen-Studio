import type { BlendMode, ShapeSpec } from '../../types';
import { mapBox, multiply, type Mat } from '../matrix';
import { pageBox } from '../shapeTransform';
import { BLUR_MARGIN, strokeReach } from '../shapeLook';
import { blendOf, buildShape, SHAPE_TAGS, type ShapeCtx } from './shapes';
import { computeStyle, declarations, parseOpacity, parseSheets, type Sheet, type Style } from './styles';
import { pageSetup, parseLength, parseTransform, numbers, viewBoxMatrix } from './transforms';

/*
 * Walk a sanitized SVG in paint order and say, for each drawable element, whether it becomes an editable shape or
 * must be rasterized, with the folder it belongs to and what it inherits: visibility (display:none), lock
 * (sodipodi:insensitive) and opacity. Groups and Inkscape layers are folders; use/symbol are expanded in place.
 */

export type Box = { x: number; y: number; w: number; h: number };
export interface Folder { id: number; name: string; layer: boolean; parent: Folder | null }
interface Common { folder: Folder | null; hidden: boolean; locked: boolean; opacity: number; blend: BlendMode; label: string | null }
export interface ShapeItem extends Common { kind: 'shape'; shape: ShapeSpec }
export interface RasterItem extends Common {
  kind: 'raster';
  reasons: string[];
  /** Page box estimated from the geometry; the rasterizer may refine it (text has no geometry to read). */
  hint: Box;
  /** Browser fonts are needed (the vector rasterizer has none). */
  text: boolean;
  /** A standalone SVG, in page units, showing just this element through `box`, `scale` output pixels per unit. */
  svgFor: (box: Box, scale: number) => string;
}
export type Item = ShapeItem | RasterItem;
export interface Walked { width: number; height: number; items: Item[]; warnings: string[] }

interface Wrap { tag: string; attrs: Array<[string, string]> }
interface Ctx { style: Style; ctm: Mat; chain: Wrap[]; folder: Folder | null; hidden: boolean; locked: boolean; opacity: number; depth: number; uses: Set<Element> }

const SKIP = new Set(['defs', 'metadata', 'title', 'desc', 'namedview', 'style', 'script', 'symbol', 'lineargradient', 'radialgradient', 'meshgradient', 'pattern', 'clippath', 'mask', 'marker', 'filter', 'font', 'cursor', 'view', 'perspective', 'color-profile']);
const RESOURCES = 'defs,style,linearGradient,radialGradient,meshgradient,pattern,clipPath,mask,filter,marker,symbol';
const MAX_DEPTH = 64;
const lc = (el: Element) => el.localName.toLowerCase();
const unionOf = (bs: Box[]): Box | null => {
  if (!bs.length) return null;
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
};
const label = (el: Element) => el.getAttribute('inkscape:label') || el.getAttribute('id') || null;

/** The page box a walked item covers (shape paint including stroke and blur margin, or the raster hint). */
export function itemBox(i: Item): Box {
  if (i.kind === 'raster') return i.hint;
  const b = pageBox(i.shape), m = strokeReach(i.shape) + BLUR_MARGIN * (i.shape.blur ?? 0);
  return { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m };
}

export function walkSvg(root: Element, maxSide = 8192): Walked {
  const page = pageSetup(root);
  const fit = Math.min(1, maxSide / Math.max(page.width, page.height));
  const width = Math.max(1, Math.round(page.width * fit)), height = Math.max(1, Math.round(page.height * fit));
  const base = multiply([fit, 0, 0, fit, 0, 0], page.matrix);
  const sheet: Sheet = parseSheets(root);
  const ids = new Map<string, Element>();
  for (const el of [root, ...Array.from(root.getElementsByTagName('*'))]) { const id = el.getAttribute('id'); if (id && !ids.has(id)) ids.set(id, el); }
  const warnings: string[] = [];
  if (sheet.skipped) warnings.push(`${sheet.skipped} CSS selector${sheet.skipped === 1 ? '' : 's'} with combinators or attributes ignored`);
  const vb = numbers(root.getAttribute('viewBox'));
  const [vw, vh] = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? [vb[2], vb[3]] : [page.width, page.height];
  const serializer = new XMLSerializer();

  // Resources every standalone element needs: styles and everything that can be referenced by id.
  const resources = Array.from(root.querySelectorAll(RESOURCES));
  const resourceMarkup = resources.filter((el) => !resources.some((o) => o !== el && o.contains(el))).map((el) => serializer.serializeToString(el)).join('');

  const rootStyle = computeStyle(root, sheet, {});
  const rootWrap: Wrap = wrapOf(root);
  const items: Item[] = [];
  let folderCount = 0;

  function wrapOf(el: Element, transform?: string): Wrap {
    const attrs: Array<[string, string]> = [];
    for (const a of Array.from(el.attributes)) {
      const n = a.name;
      if (/^(id|opacity|display|filter|clip-path|mask|width|height|viewBox|preserveAspectRatio|version|x|y|href|xlink:href|transform)$/.test(n) || /^(xmlns|inkscape:|sodipodi:|xml:)/.test(n)) continue;
      if (n === 'style') { const d = declarations(a.value); for (const k of ['opacity', 'display', 'filter', 'clip-path', 'mask']) delete d[k]; attrs.push([n, Object.entries(d).map(([k, v]) => `${k}:${v}`).join(';')]); continue; }
      attrs.push([n, a.value]);
    }
    const t = transform ?? el.getAttribute('transform');
    if (t) attrs.push(['transform', t]);
    return { tag: 'g', attrs };
  }
  const open = (w: Wrap) => `<g${w.attrs.map(([k, v]) => ` ${k}="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`).join('')}>`;

  /** The element as markup that draws even when its own display is none. */
  function bareMarkup(el: Element): string {
    const clone = el.cloneNode(true) as Element;
    clone.removeAttribute('display');
    const st = clone.getAttribute('style');
    if (st) { const d = declarations(st); delete d.display; clone.setAttribute('style', Object.entries(d).map(([k, v]) => `${k}:${v}`).join(';')); }
    return serializer.serializeToString(clone);
  }

  function rasterItem(el: Element, ctx: Ctx, reasons: string[], hint: Box, text: boolean, name: string | null, markup = bareMarkup(el)): RasterItem {
    const chain = ctx.chain;
    return {
      kind: 'raster', reasons, hint, text, folder: ctx.folder, hidden: ctx.hidden, locked: ctx.locked || el.getAttribute('sodipodi:insensitive') === 'true', opacity: ctx.opacity, blend: blendOf(computeStyle(el, sheet, ctx.style)), label: name,
      svgFor: (box, scale) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="${Math.max(1, Math.ceil(box.w * scale))}" height="${Math.max(1, Math.ceil(box.h * scale))}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}">${resourceMarkup}<g transform="matrix(${base.join(' ')})">${chain.map(open).join('')}${markup}${chain.map(() => '</g>').join('')}</g></svg>`,
    };
  }

  function textHint(el: Element, style: Style, ctm: Mat): Box {
    const size = parseLength(style['font-size'], 16, 16) ?? 16;
    const lines = (el.textContent ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    const longest = Math.max(1, ...lines.map((l) => l.length));
    const x = numbers(el.getAttribute('x'))[0] ?? 0, y = numbers(el.getAttribute('y'))[0] ?? 0;
    const w = longest * size * 0.6, anchor = style['text-anchor'];
    const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
    return mapBox(ctm, { x: x0, y: y - size, w, h: size * 1.3 * Math.max(1, lines.length) });
  }

  function walkChildren(el: Element, ctx: Ctx, out: Item[]): void {
    for (const child of Array.from(el.children)) walk(child, ctx, out);
  }

  function walk(el: Element, ctx: Ctx, out: Item[]): void {
    const name = lc(el);
    if (SKIP.has(name) || ctx.depth > MAX_DEPTH) return;
    const style = computeStyle(el, sheet, ctx.style);
    const own = parseTransform(el.getAttribute('transform'));
    const ctm = multiply(ctx.ctm, own);
    const hidden = ctx.hidden || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse';
    const locked = ctx.locked || el.getAttribute('sodipodi:insensitive') === 'true';
    const inner: Ctx = { ...ctx, style, ctm, hidden, locked, depth: ctx.depth + 1 };
    const shapeCtx: ShapeCtx = { ctm, ids, vw, vh, fontSize: parseLength(style['font-size'], 16, 16) ?? 16 };

    if (name === 'g' || name === 'a' || name === 'switch' || name === 'svg') {
      const reasons: string[] = [];
      if (style.filter && style.filter !== 'none') reasons.push('filter');
      if (style['clip-path'] && style['clip-path'] !== 'none') reasons.push('clip-path');
      if (style.mask && style.mask !== 'none') reasons.push('mask');
      let gctm = ctm;
      if (name === 'svg') {
        const bx = parseLength(el.getAttribute('x'), vw) ?? 0, by = parseLength(el.getAttribute('y'), vh) ?? 0;
        const nvb = numbers(el.getAttribute('viewBox')), nw = parseLength(el.getAttribute('width'), vw), nh = parseLength(el.getAttribute('height'), vh);
        gctm = multiply(ctm, [1, 0, 0, 1, bx, by]);
        if (nvb.length === 4 && nvb[2] > 0 && nvb[3] > 0 && nw && nh) gctm = multiply(gctm, viewBoxMatrix(nvb, nw, nh, el.getAttribute('preserveAspectRatio')));
        warnings.includes('nested svg: clip to its viewport ignored') || warnings.push('nested svg: clip to its viewport ignored');
      }
      if (reasons.length) {
        // A group with an effect over all its content is one picture: drawn alone, then placed.
        const sub: Item[] = [];
        walkChildren(el, { ...inner, ctm: gctm, hidden: false, chain: [], depth: inner.depth }, sub);
        const hint = unionOf(sub.map(itemBox));
        if (hint) out.push(rasterItem(el, { ...ctx, hidden, locked }, reasons, hint, sub.some((s) => s.kind === 'raster' && s.text), label(el)));
        return;
      }
      const isLayer = el.getAttribute('inkscape:groupmode') === 'layer';
      const folder: Folder | null = name === 'svg' ? ctx.folder : { id: ++folderCount, name: label(el) ?? (isLayer ? 'Layer' : 'Group'), layer: isLayer, parent: ctx.folder };
      walkChildren(el, { ...inner, ctm: gctm, folder, opacity: ctx.opacity * parseOpacity(style.opacity), chain: [...ctx.chain, wrapOf(el)] }, out);
      return;
    }

    if (name === 'use') {
      const href = el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '';
      const target = href.startsWith('#') ? ids.get(href.slice(1)) : undefined;
      if (!target || ctx.uses.has(target) || target.contains(el)) { warnings.push('a use pointing nowhere or into itself was skipped'); return; }
      const dx = parseLength(el.getAttribute('x'), vw) ?? 0, dy = parseLength(el.getAttribute('y'), vh) ?? 0;
      const tctm = multiply(ctm, [1, 0, 0, 1, dx, dy]);
      const uses = new Set(ctx.uses).add(target);
      const wrap = wrapOf(el, `${el.getAttribute('transform') ?? ''} translate(${dx} ${dy})`.trim());
      const useCtx: Ctx = { ...inner, ctm: tctm, uses, opacity: ctx.opacity * parseOpacity(style.opacity), chain: [...ctx.chain, wrap] };
      if (lc(target) === 'symbol') {
        const svb = numbers(target.getAttribute('viewBox')), uw = parseLength(el.getAttribute('width'), vw), uh = parseLength(el.getAttribute('height'), vh);
        const sctm = svb.length === 4 && svb[2] > 0 && svb[3] > 0 ? multiply(tctm, viewBoxMatrix(svb, uw ?? svb[2], uh ?? svb[3], target.getAttribute('preserveAspectRatio'))) : tctm;
        const symWrap = svb.length === 4 && svb[2] > 0 && svb[3] > 0 ? { tag: 'g', attrs: [['transform', `matrix(${viewBoxMatrix(svb, uw ?? svb[2], uh ?? svb[3], target.getAttribute('preserveAspectRatio')).join(' ')})`]] as Array<[string, string]> } : null;
        walkChildren(target, { ...useCtx, ctm: sctm, chain: symWrap ? [...useCtx.chain, symWrap] : useCtx.chain }, out);
      } else walk(target, useCtx, out);
      return;
    }

    const common = { folder: ctx.folder, hidden, locked, label: label(el) };
    if (SHAPE_TAGS.has(name)) {
      const r = buildShape(el, style, shapeCtx);
      if (r.ok === true) out.push({ kind: 'shape', shape: r.shape, ...common, opacity: ctx.opacity * r.opacity, blend: r.blend });
      else if (r.ok === false) out.push(rasterItem(el, { ...ctx, hidden, locked }, r.reasons, r.hint, false, label(el)));
      return;
    }
    if (name === 'text' || name === 'flowroot') {
      out.push(rasterItem(el, { ...ctx, hidden, locked }, ['text'], textHint(el, style, ctm), true, label(el)));
      return;
    }
    if (name === 'image') {
      const x = parseLength(el.getAttribute('x'), vw) ?? 0, y = parseLength(el.getAttribute('y'), vh) ?? 0, w = parseLength(el.getAttribute('width'), vw) ?? 0, h = parseLength(el.getAttribute('height'), vh) ?? 0;
      if (w > 0 && h > 0) out.push(rasterItem(el, { ...ctx, hidden, locked }, ['image'], mapBox(ctm, { x, y, w, h }), false, label(el)));
    }
  }

  const start: Ctx = { style: rootStyle, ctm: base, chain: [rootWrap], folder: null, hidden: rootStyle.display === 'none', locked: root.getAttribute('sodipodi:insensitive') === 'true', opacity: parseOpacity(rootStyle.opacity), depth: 0, uses: new Set() };
  walkChildren(root, start, items);
  return { width, height, items, warnings };
}
