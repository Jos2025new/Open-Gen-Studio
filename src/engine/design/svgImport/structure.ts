import type { BlendMode, ShapeSpec } from '../../types';
import { mapBox, multiply, type Mat } from '../matrix';
import { pageBox } from '../shapeTransform';
import { BLUR_MARGIN, strokeReach } from '../shapeLook';
import { blendOf, blurOf, buildShape, SHAPE_TAGS, type ShapeCtx } from './shapes';
import { computeStyle, declarations, parseOpacity, parseSheets, type Sheet, type Style } from './styles';
import { pageSetup, parseLength, parseTransform, numbers, viewBoxMatrix } from './transforms';
import { normalizePath } from './pathData';

/*
 * Walk a sanitized SVG in paint order and say, for each drawable element, whether it becomes an editable shape or
 * must be rasterized, and where it sits: its layer (an Inkscape layer, an Illustrator top-level named group, or the
 * page) and the chain of groups above it inside that layer. Layer and group keep what is theirs: visibility
 * (display:none), lock (sodipodi:insensitive), opacity and blend. use/symbol are expanded in place.
 */

export type Box = { x: number; y: number; w: number; h: number };
/** What an element, a group or a layer sets by itself. */
export interface Own { hidden: boolean; locked: boolean; opacity: number; blend: BlendMode }
/** A layer, with what it and the layers above it set; `name` null is the page itself (content outside any layer). */
export interface Place extends Own { id: number; name: string | null; parent: Place | null }
/** A group inside a layer. */
export interface GroupNode extends Own { id: number; name: string }
/** `groups` outermost first; hidden, locked, opacity and blend are the element's own. */
interface Common extends Own { place: Place; groups: GroupNode[]; label: string | null }
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
export interface EmptyLayerItem { kind: 'empty-layer'; place: Place }
export type Item = ShapeItem | RasterItem | EmptyLayerItem;
export interface Walked { width: number; height: number; items: Item[]; warnings: string[] }

interface Wrap { tag: string; attrs: Array<[string, string]> }
/** `filter` and `carry` come from the <g data-ogs="shape"> around one shape (how this app writes a shape with definitions): they are that shape's. */
interface Ctx { style: Style; ctm: Mat; chain: Wrap[]; place: Place; groups: GroupNode[]; depth: number; uses: Set<Element>; filter?: string; carry?: Own & { label: string | null } }

const SKIP = new Set(['defs', 'metadata', 'title', 'desc', 'namedview', 'style', 'script', 'symbol', 'lineargradient', 'radialgradient', 'meshgradient', 'pattern', 'clippath', 'mask', 'marker', 'filter', 'font', 'cursor', 'view', 'perspective', 'color-profile']);
const RESOURCES = 'defs,style,linearGradient,radialGradient,meshgradient,pattern,clipPath,mask,filter,marker,symbol';
const MAX_DEPTH = 64;
const MAX_USE_EXPANSIONS = 4096;
const lc = (el: Element) => el.localName.toLowerCase();
const finiteValues = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value);
  return !value || typeof value !== 'object' || Object.values(value).every(finiteValues);
};
const unionOf = (bs: Box[]): Box | null => {
  if (!bs.length) return null;
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
};
/** The name its author gave it: Inkscape's label, Illustrator's data-name, or an id that is not Inkscape's automatic one (rect123). */
export function nameOf(el: Element): string | null {
  const id = el.getAttribute('id');
  return el.getAttribute('inkscape:label') || el.getAttribute('data-name')
    || (id && !/^[a-z]+\d+(-\d+)*$/i.test(id) ? id.replace(/_x([0-9A-F]{2})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))) : null);
}
const label = nameOf;
const DRAWN = (el: Element) => !SKIP.has(lc(el));

/** The page box a walked item covers (shape paint including stroke and blur margin, or the raster hint). */
export function itemBox(i: ShapeItem | RasterItem): Box {
  if (i.kind === 'raster') return i.hint;
  const b = pageBox(i.shape), m = strokeReach(i.shape) + BLUR_MARGIN * (i.shape.blur ?? 0);
  return { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m };
}

export function walkSvg(root: Element, maxSide = 8192): Walked {
  const setup = pageSetup(root);
  const fit = Math.min(1, maxSide / Math.max(setup.width, setup.height));
  const width = Math.max(1, Math.round(setup.width * fit)), height = Math.max(1, Math.round(setup.height * fit));
  const base = multiply([fit, 0, 0, fit, 0, 0], setup.matrix);
  const sheet: Sheet = parseSheets(root);
  const ids = new Map<string, Element>();
  for (const el of [root, ...Array.from(root.getElementsByTagName('*'))]) { const id = el.getAttribute('id'); if (id && !ids.has(id)) ids.set(id, el); }
  const warnings: string[] = [];
  if (sheet.skipped) warnings.push(`${sheet.skipped} CSS selector${sheet.skipped === 1 ? '' : 's'} with combinators or attributes ignored`);
  const vb = numbers(root.getAttribute('viewBox'));
  const [vw, vh] = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0 ? [vb[2], vb[3]] : [setup.width, setup.height];
  const serializer = new XMLSerializer();

  // Resources every standalone element needs: styles and everything that can be referenced by id.
  const resources = Array.from(root.querySelectorAll(RESOURCES));
  const resourceMarkup = resources.filter((el) => !resources.some((o) => o !== el && o.contains(el))).map((el) => serializer.serializeToString(el)).join('');

  const rootStyle = computeStyle(root, sheet, {});
  const rootWrap: Wrap = wrapOf(root);
  const items: Item[] = [];
  let count = 0, useExpansions = 0;

  /** The clip as a page rectangle, when it is one plain upright rectangle (a rect, or a path that draws one); null otherwise. */
  function clipBox(value: string, ctm: Mat): Box | null {
    const m = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)$/.exec(value.trim());
    const clip = m ? ids.get(m[1]) : undefined;
    if (!clip || lc(clip) !== 'clippath' || clip.getAttribute('clipPathUnits') === 'objectBoundingBox' || clip.getAttribute('transform')) return null;
    const kids = Array.from(clip.children).filter(DRAWN), r = kids[0];
    if (kids.length !== 1 || r.getAttribute('transform') || Math.abs(ctm[1]) > 1e-9 || Math.abs(ctm[2]) > 1e-9) return null;
    if (lc(r) === 'rect') {
      const num = (k: string, ref: number) => parseLength(r.getAttribute(k), ref) ?? 0;
      return num('rx', vw) > 0 || num('ry', vh) > 0 ? null : mapBox(ctm, { x: num('x', vw), y: num('y', vh), w: num('width', vw), h: num('height', vh) });
    }
    const p = lc(r) === 'path' ? normalizePath(r.getAttribute('d') ?? '', ctm) : null;
    if (!p || /[^MLZ\d\s.eE+-]/.test(p.d)) return null;
    // Every corner of the path is a corner of its box, and all four are there.
    const n = numbers(p.d.replace(/[MLZ]/g, ' ')), corners = new Set<string>(), near = (v: number, t: number) => Math.abs(v - t) < 1e-6;
    for (let i = 0; i + 1 < n.length; i += 2) {
      const left = near(n[i], p.box.x), right = near(n[i], p.box.x + p.box.w), top = near(n[i + 1], p.box.y), bottom = near(n[i + 1], p.box.y + p.box.h);
      if (!(left || right) || !(top || bottom)) return null;
      corners.add(`${left ? 0 : 1}${top ? 0 : 1}`);
    }
    return corners.size === 4 ? p.box : null;
  }
  const covers = (a: Box, b: Box) => a.x <= b.x + 0.5 && a.y <= b.y + 0.5 && a.x + a.w >= b.x + b.w - 0.5 && a.y + a.h >= b.y + b.h - 0.5;
  const isLayerEl = (g: Element) => lc(g) === 'g' && (g.getAttribute('inkscape:groupmode') === 'layer' || g.hasAttribute('data-name'));

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

  function rasterItem(el: Element, ctx: Ctx, own: Own, reasons: string[], hint: Box, text: boolean, name: string | null, markup = bareMarkup(el)): RasterItem {
    const chain = ctx.chain;
    return {
      // Its own opacity is in the picture (the markup keeps it); what is above it is not.
      kind: 'raster', reasons, hint, text, place: ctx.place, groups: ctx.groups, ...own, opacity: 1, label: name,
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

  /**
   * A stroke inside or outside the edge, as this app writes it: the fill, and a stroke twice as wide cut to the shape
   * or to the rest (export.ts alignedBody). Read back as one shape; null when it is not that any more.
   */
  function alignedShape(kids: Element[], style: Style, ctm: Mat, align: 'inside' | 'outside'): ShapeSpec | null {
    const fillEl = kids.find((k) => SHAPE_TAGS.has(lc(k))), wrap = kids.find((k) => lc(k) === 'g');
    const strokeEl = wrap && Array.from(wrap.children).filter(DRAWN);
    if (kids.length !== 2 || !fillEl || !wrap || strokeEl!.length !== 1 || !SHAPE_TAGS.has(lc(strokeEl![0]))) return null;
    const build = (k: Element, st: Style) => buildShape(k, st, { ctm: multiply(ctm, parseTransform(k.getAttribute('transform'))), ids, vw, vh, fontSize: parseLength(st['font-size'], 16, 16) ?? 16 });
    const f = build(fillEl, { ...computeStyle(fillEl, sheet, style), ...(style.filter ? { filter: style.filter } : {}) });
    const s = build(strokeEl![0], computeStyle(strokeEl![0], sheet, computeStyle(wrap, sheet, style)));
    if (f.ok !== true || s.ok !== true) return null;
    const a = s.shape;
    const stroke: Partial<ShapeSpec> = {
      stroke: a.stroke, strokeGradient: a.strokeGradient, strokeWidth: a.strokeWidth / 2, strokeOpacity: a.strokeOpacity, join: a.join, cap: a.cap, miter: a.miter,
      dash: a.dash?.map((d) => d * 2), dashOffset: a.dashOffset ? a.dashOffset * 2 : undefined, strokeAlign: align, paintOrder: kids[0] === wrap ? 'stroke' : undefined,
    };
    return { ...f.shape, ...Object.fromEntries(Object.entries(stroke).filter(([, v]) => v !== undefined)) } as ShapeSpec;
  }

  function walkChildren(el: Element, ctx: Ctx, out: Item[]): void {
    for (const child of Array.from(el.children)) walk(child, ctx, out);
  }

  function walk(el: Element, ctx: Ctx, out: Item[]): void {
    const name = lc(el);
    if (SKIP.has(name)) return;
    if (ctx.depth > MAX_DEPTH) {
      if (!warnings.includes('SVG nesting limit reached; content skipped')) warnings.push('SVG nesting limit reached; content skipped');
      return;
    }
    let style = computeStyle(el, sheet, ctx.style);
    // The blur of a wrapper around one shape (how this app writes a blurred shape) is that shape's blur.
    if (ctx.filter && !style.filter) style = { ...style, filter: ctx.filter };
    const ctm = multiply(ctx.ctm, parseTransform(el.getAttribute('transform')));
    if (!ctm.every(Number.isFinite)) { warnings.push('element with non-finite transform was skipped'); return; }
    const container = name === 'g' || name === 'a' || name === 'switch' || name === 'svg';
    // visibility is inherited, so every element below reads it by itself; display:none belongs to the one that sets it.
    const own: Own = {
      hidden: style.display === 'none' || (!container && (style.visibility === 'hidden' || style.visibility === 'collapse')),
      locked: el.getAttribute('sodipodi:insensitive') === 'true', opacity: parseOpacity(style.opacity), blend: blendOf(style),
    };
    if (ctx.carry) Object.assign(own, { hidden: own.hidden || ctx.carry.hidden, locked: own.locked || ctx.carry.locked, opacity: own.opacity * ctx.carry.opacity, blend: own.blend !== 'normal' ? own.blend : ctx.carry.blend });
    const named = ctx.carry?.label ?? label(el);
    const inner: Ctx = { ...ctx, style, ctm, depth: ctx.depth + 1, filter: undefined, carry: undefined };
    const shapeCtx: ShapeCtx = { ctm, ids, vw, vh, fontSize: parseLength(style['font-size'], 16, 16) ?? 16 };

    if (container) {
      const reasons: string[] = [];
      const kids = Array.from(el.children).filter(DRAWN), ogs = name === 'g' ? el.getAttribute('data-ogs') : null;
      if (ogs === 'stroke-inside' || ogs === 'stroke-outside') {
        const shape = alignedShape(kids, style, ctm, ogs === 'stroke-inside' ? 'inside' : 'outside');
        if (shape) { out.push({ kind: 'shape', shape, place: ctx.place, groups: ctx.groups, label: named, ...own }); return; }
      }
      const blurOne = style.filter && style.filter !== 'none' && kids.length === 1 && typeof blurOf(style, ids) === 'number';
      if (style.filter && style.filter !== 'none' && !blurOne) reasons.push('filter');
      // A rectangular clip that cuts nothing (the page of this app's export, a Figma frame, Canva's box around each
      // element) is no reason for a picture: decided below, once what is inside is known.
      const clipValue = style['clip-path'] && style['clip-path'] !== 'none' ? style['clip-path'] : null;
      const clip = clipValue ? clipBox(clipValue, ctm) : null;
      if (clipValue && !clip) reasons.push('clip-path');
      if (style.mask && style.mask !== 'none') reasons.push('mask');
      let gctm = ctm;
      if (name === 'svg') {
        const bx = parseLength(el.getAttribute('x'), vw) ?? 0, by = parseLength(el.getAttribute('y'), vh) ?? 0;
        const nvb = numbers(el.getAttribute('viewBox')), nw = parseLength(el.getAttribute('width'), vw), nh = parseLength(el.getAttribute('height'), vh);
        gctm = multiply(ctm, [1, 0, 0, 1, bx, by]);
        if (nvb.length === 4 && nvb.every(Number.isFinite) && nvb[2] > 0 && nvb[3] > 0 && nw && nh) gctm = multiply(gctm, viewBoxMatrix(nvb, nw, nh, el.getAttribute('preserveAspectRatio')));
        warnings.includes('nested svg: clip to its viewport ignored') || warnings.push('nested svg: clip to its viewport ignored');
      }
      const down: Ctx = { ...inner, ctm: gctm, chain: [...ctx.chain, wrapOf(el)], filter: blurOne ? style.filter : undefined };
      if (!gctm.every(Number.isFinite)) { warnings.push('element with non-finite transform was skipped'); return; }
      const sub: Item[] = [];
      // Layers: Inkscape's, and Illustrator's (a named group right on the page). Inside a group a layer is a group, as in Inkscape.
      const onPage = !ctx.groups.length && (el.getAttribute('inkscape:groupmode') === 'layer' || ctx.place.name === null);
      // A wrapper that says nothing (no name, look or state) around one thing, around layers, or cut by nothing, is no group.
      const plain = !named && !own.hidden && !own.locked && own.opacity >= 1 && own.blend === 'normal';
      if (name === 'g' && onPage && isLayerEl(el)) {
        const up = ctx.place;
        const place: Place = { id: ++count, name: named ?? 'Layer', parent: up, hidden: up.hidden || own.hidden, locked: up.locked || own.locked, opacity: up.opacity * own.opacity, blend: own.blend !== 'normal' ? own.blend : up.blend };
        walkChildren(el, { ...down, place }, sub);
        if (!kids.length) sub.push({ kind: 'empty-layer', place });
      } else if (ogs === 'shape' && kids.length === 1) walkChildren(el, { ...down, carry: { ...own, label: named } }, sub);
      else if (name !== 'g' || (plain && (kids.length <= 1 || !!clip || (!ctx.groups.length && kids.every(isLayerEl))))) walkChildren(el, down, sub);
      else walkChildren(el, { ...down, groups: [...ctx.groups, { id: ++count, name: named ?? 'Group', ...own }] }, sub);
      const inside = unionOf(sub.filter((i): i is ShapeItem | RasterItem => i.kind !== 'empty-layer').map(itemBox));
      if (clip && inside && !covers(clip, { x: 0, y: 0, w: width, h: height }) && !covers(clip, inside)) reasons.push('clip-path');
      // A group with an effect over all its content is one picture: drawn alone, then placed.
      if (!reasons.length) out.push(...sub);
      else if (inside) out.push(rasterItem(el, ctx, own, reasons, inside, sub.some((i) => i.kind === 'raster' && i.text), named));
      return;
    }

    if (name === 'use') {
      if (useExpansions >= MAX_USE_EXPANSIONS) {
        if (!warnings.includes('use expansion limit reached; content skipped')) warnings.push('use expansion limit reached; content skipped');
        return;
      }
      useExpansions++;
      const href = el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '';
      const target = href.startsWith('#') ? ids.get(href.slice(1)) : undefined;
      if (!target || ctx.uses.has(target) || target.contains(el)) { warnings.push('a use pointing nowhere or into itself was skipped'); return; }
      const dx = parseLength(el.getAttribute('x'), vw) ?? 0, dy = parseLength(el.getAttribute('y'), vh) ?? 0;
      const tctm = multiply(ctm, [1, 0, 0, 1, dx, dy]);
      const uses = new Set(ctx.uses).add(target);
      const wrap = wrapOf(el, `${el.getAttribute('transform') ?? ''} translate(${dx} ${dy})`.trim());
      // A use is a group of what it points to: its opacity, blend and state stay on that group.
      const plainUse = !own.hidden && !own.locked && own.opacity >= 1 && own.blend === 'normal';
      const useCtx: Ctx = { ...inner, ctm: tctm, uses, chain: [...ctx.chain, wrap], groups: plainUse ? ctx.groups : [...ctx.groups, { id: ++count, name: named ?? 'Group', ...own }] };
      if (lc(target) === 'symbol') {
        const svb = numbers(target.getAttribute('viewBox')), uw = parseLength(el.getAttribute('width'), vw), uh = parseLength(el.getAttribute('height'), vh);
        const validViewBox = svb.length === 4 && svb.every(Number.isFinite) && svb[2] > 0 && svb[3] > 0;
        const sctm = validViewBox ? multiply(tctm, viewBoxMatrix(svb, uw ?? svb[2], uh ?? svb[3], target.getAttribute('preserveAspectRatio'))) : tctm;
        if (!sctm.every(Number.isFinite)) { warnings.push('symbol with non-finite transform was skipped'); return; }
        const symWrap = validViewBox ? { tag: 'g', attrs: [['transform', `matrix(${viewBoxMatrix(svb, uw ?? svb[2], uh ?? svb[3], target.getAttribute('preserveAspectRatio')).join(' ')})`]] as Array<[string, string]> } : null;
        walkChildren(target, { ...useCtx, ctm: sctm, chain: symWrap ? [...useCtx.chain, symWrap] : useCtx.chain }, out);
      } else walk(target, useCtx, out);
      return;
    }

    const common = { place: ctx.place, groups: ctx.groups, label: named };
    if (SHAPE_TAGS.has(name)) {
      const r = buildShape(el, style, shapeCtx);
      if (r.ok === true && finiteValues(r.shape)) out.push({ kind: 'shape', shape: r.shape, ...common, ...own });
      else if (r.ok === true) warnings.push('shape with non-finite values was skipped');
      else if (r.ok === false) out.push(rasterItem(el, ctx, own, r.reasons, r.hint, false, named));
      return;
    }
    if (name === 'text' || name === 'flowroot') {
      out.push(rasterItem(el, ctx, own, ['text'], textHint(el, style, ctm), true, named));
      return;
    }
    if (name === 'image') {
      const x = parseLength(el.getAttribute('x'), vw) ?? 0, y = parseLength(el.getAttribute('y'), vh) ?? 0, w = parseLength(el.getAttribute('width'), vw) ?? 0, h = parseLength(el.getAttribute('height'), vh) ?? 0;
      if (w > 0 && h > 0) out.push(rasterItem(el, ctx, own, ['image'], mapBox(ctm, { x, y, w, h }), false, named));
      else warnings.push('image without a usable width and height was skipped');
    }
  }

  const page: Place = { id: 0, name: null, parent: null, hidden: rootStyle.display === 'none', locked: root.getAttribute('sodipodi:insensitive') === 'true', opacity: parseOpacity(rootStyle.opacity), blend: 'normal' };
  const start: Ctx = { style: rootStyle, ctm: base, chain: [rootWrap], place: page, groups: [], depth: 0, uses: new Set() };
  walkChildren(root, start, items);
  return { width, height, items, warnings };
}
