import { allFinite, finiteDoc } from './exportFinite';
import { shapesSvgTree, shownLayer } from './objectGroupTree';
import { MARK_LENGTH_MM, MARK_OFFSET_MM, PX_PER_MM, pageLayout, type PdfPage, type PrintOptions, type SvgOptions } from './exportSettings';
import { pathTransform } from './path';
import { markerSvg } from './markers';
import { gradientSvg } from './gradientPaint';

const gradId = (s: VectorShape, side: 'f' | 's') => `g-${xmlEscape(s.id)}-${side}`;
import { shapeMatrix } from './shapeTransform';
import { multiply } from './matrix';
import { inkscapePrimAttrs } from './inkscapeShape';
import { decorationRects } from './textLayout';
import { base64, canOutline, textPathData, type FontLoader } from './exportText';
import { blurFilterSvg, blurRegion, cornerRadii, roundRectPath, strokeAlignOf, strokeLookSvg } from './shapeLook';
import { linkedBrandHref } from '../brandExportFolder';
import type { DesignDoc, Layer, TextLayer, VectorShape } from '../types';
import { fontStack, shapeBox, type Box } from './doc';
import { strokeSvg } from './brushTextures';
import { fxPlan } from '../fx/plan';
import { fxFilter } from '../fx/svg';
import { FX_DEFS } from '../fx/defs';
import type { FxLayer } from '../fx/types';

/*
 * Vector export. Each layer stays an editable object: shapes as SVG shapes, text as <text> (editable when the
 * font is installed), images as embedded PNG (never a blob: URL). Layers become Inkscape layers (inkscape:label)
 * so the structure survives. Blend modes use CSS mix-blend-mode; how far other editors honor it is not verified.
 * FX layers become SVG filters (fx/svg.ts).
 */

export type { ExportFormat } from './exportSettings';


export interface SvgDeps {
  /** Data URL of a raster layer's pixels (as displayed). Null when they could not be read (an empty layer still has a
   *  buffer after ensureBuffers): the layer is left out and the notice says so. */
  rasterHref: (layer: Extract<Layer, { type: 'raster' }>) => Promise<string | null>;
  /** Wrapped lines of a text layer, as the canvas renderer lays them out. */
  layout: (layer: TextLayer) => { lines: string[]; width: number; lineHeightPx: number };
  /** Distance from the top of the em box to the baseline, in px (canvas 'top' baseline → SVG alphabetic). */
  ascent: (layer: TextLayer) => number;
  /** WOFF bytes of the bundled font for a family and weight; null when the app has none (system fonts). */
  fontFile?: FontLoader;
  /** Pixel size of a raster layer's buffer (for the print preflight). */
  rasterSize?: (layer: Extract<Layer, { type: 'raster' }>) => { w: number; h: number } | null;
  /** Data URL of a document drawn on its page (or on `box` of it), transparent where nothing is. With it, what an
   *  effect the file cannot say covers is written as a picture (and said); without it, the effect is left out (and said). */
  picture?: (doc: DesignDoc, box?: Box, scale?: number) => Promise<string | null>;
  /** What the SVG could not keep (an FX with no SVG equivalent, unreadable pixels), said once per export. */
  notice?: (message: string) => void;
}

export function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/** Numbers without float noise (0.30000000000000004 → 0.3). */
export function n(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

function paint(s: VectorShape, strokeWidth: number, fill: string | null | undefined = s.fill ?? (s.fillGradient ? 'gradient' : null)): string {
  const fv = fill === 'gradient' && s.fillGradient ? `url(#${gradId(s, 'f')})` : fill;
  const sv = s.strokeGradient && s.strokeWidth > 0 ? `url(#${gradId(s, 's')})` : s.stroke;
  const fo = fill && s.fillOpacity != null && s.fillOpacity < 1 ? ` fill-opacity="${n(Math.max(0, s.fillOpacity))}"` : '';
  const so = (s.stroke || s.strokeGradient) && strokeWidth > 0 && s.strokeOpacity != null && s.strokeOpacity < 1 ? ` stroke-opacity="${n(Math.max(0, s.strokeOpacity))}"` : '';
  const fr = fill && s.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '';
  return `fill="${fv ? xmlEscape(fv) : 'none'}"${fo}${fr}${so}${(s.stroke || s.strokeGradient) && strokeWidth > 0 ? ` stroke="${xmlEscape(sv ?? '')}" stroke-width="${n(strokeWidth)}"${strokeLookSvg(s, strokeWidth)}` : ''}`;
}

/** A shape, wrapped with its own blur filter when it has one (shapeLook.ts: Inkscape's 2.4σ margin). */
export function shapeSvg(s: VectorShape): string {
  // Arrowheads: <marker> definitions beside the shape, attached to its line or path (markers.ts).
  const mk = s.stroke && s.strokeWidth > 0 ? markerSvg(s, `mk-${xmlEscape(s.id)}`, s.stroke, xmlEscape) : { defs: '', attrs: '' };
  const aligned = strokeAlignOf(s) !== 'center' && !!(s.stroke || s.strokeGradient) && s.strokeWidth > 0;
  const body = aligned ? alignedBody(s) : mk.attrs ? shapeBody(s).replace(/\/>$/, ` ${mk.attrs}/>`) : shapeBody(s);
  // Editable gradients: their <linearGradient>/<radialGradient> definitions sit beside the shape, like its markers.
  const grads = (s.fillGradient ? gradientSvg(s.fillGradient, s, gradId(s, 'f'), xmlEscape) : '') + (s.strokeGradient && s.strokeWidth > 0 ? gradientSvg(s.strokeGradient, s, gradId(s, 's'), xmlEscape) : '');
  // data-ogs="shape": this <g> is one shape with its definitions, not a group (svgImport/structure.ts reads it back).
  const marked = mk.defs || grads ? `<g data-ogs="shape"><defs>${mk.defs}${grads}</defs>${body}</g>` : body;
  if (!s.blur || s.blur <= 0) return marked;
  const id = `blur-${xmlEscape(s.id)}`;
  return `<g data-ogs="shape" filter="url(#${id})"><defs>${blurFilterSvg(id, s)}</defs>${marked}</g>`;
}

/**
 * Inside / outside stroke: the fill as usual, then a stroke twice as wide cut to the shape (a clipPath) or to everything
 * else (a mask: white page, black shape). Dashes are halved so they keep their size at the doubled width.
 */
function alignedBody(s: VectorShape): string {
  const id = `sa-${xmlEscape(s.id)}`;
  const plain: VectorShape = { ...s, strokeAlign: undefined, };
  const fillEl = shapeBody({ ...plain, stroke: null, strokeGradient: undefined, dash: undefined });
  const strokeEl = shapeBody({ ...plain, fill: null, fillGradient: undefined, strokeWidth: s.strokeWidth * 2, dash: s.dash?.map((d) => d / 2), dashOffset: s.dashOffset ? s.dashOffset / 2 : s.dashOffset });
  let geo = shapeBody({ ...plain, fill: '#000', fillGradient: undefined, fillOpacity: undefined, stroke: null, strokeGradient: undefined, strokeWidth: 0, dash: undefined, paintOrder: undefined });
  const inside = strokeAlignOf(s) === 'inside';
  if (inside && s.fillRule === 'evenodd') geo = geo.replace(/^<(\w+) /, '<$1 clip-rule="evenodd" ');
  // Outside: the shape is cut out even-odd, as the canvas clips it (render.ts), so both agree on self-overlaps.
  if (!inside) geo = geo.replace(/^<(\w+) /, '<$1 fill-rule="evenodd" ');
  // The mask covers the shape and its reach with room for turns and skews, not a huge page some renderers would allocate.
  const b = shapeBox(s), m = Math.max(b.w, b.h) + s.strokeWidth * 4 + 1;
  const n = (v: number) => +v.toFixed(3), area = `x="${n(b.x - m)}" y="${n(b.y - m)}" width="${n(b.w + 2 * m)}" height="${n(b.h + 2 * m)}"`;
  const def = inside ? `<clipPath id="${id}">${geo}</clipPath>` : `<mask id="${id}" maskUnits="userSpaceOnUse" ${area}><rect ${area} fill="#fff"/>${geo}</mask>`;
  const stroked = `<g ${inside ? 'clip-path' : 'mask'}="url(#${id})">${strokeEl}</g>`;
  return `<g data-ogs="stroke-${inside ? 'inside' : 'outside'}"><defs>${def}</defs>${s.paintOrder === 'stroke' ? stroked + fillEl : fillEl + stroked}</g>`;
}

function shapeBody(s: VectorShape): string {
  // A turned or skewed rectangle or ellipse keeps its element, with the turn as transform (as Inkscape writes it).
  // Six decimals: three moved edges ~0.15 px at 300 px from the origin (visible in the canvas/SVG comparison).
  if (s.rot && (s.type === 'rect' || s.type === 'ellipse')) { const m = shapeMatrix(s); return shapeBody({ ...s, rot: undefined }).replace(/^<(\w+) /, `<$1 transform="matrix(${m.map((v) => String(+v.toFixed(6))).join(' ')})" `); }
  if (s.type === 'path') {
    const t = pathTransform(s);
    const k = Math.max(1e-6, Math.sqrt(Math.abs(t.sx * t.sy)));
    // A turned path (converted shape): its turn and its own placement in one matrix.
    const m = multiply(s.rot ? shapeMatrix(s) : [1, 0, 0, 1, 0, 0], [t.sx, 0, 0, t.sy, t.tx, t.ty]);
    return `<path d="${xmlEscape(s.d ?? '')}" transform="matrix(${m.map((v) => String(+v.toFixed(6))).join(' ')})"${s.prim ? inkscapePrimAttrs(s.prim) : ''}${s.nodeTypes ? ` sodipodi:nodetypes="${xmlEscape(s.nodeTypes)}"` : ''} ${paint(s, s.scaleStroke ? s.strokeWidth : s.strokeWidth / k)}/>`;
  }
  if (s.type === 'rect') {
    const x = Math.min(s.x, s.x + s.w);
    const y = Math.min(s.y, s.y + s.h);
    const w = Math.abs(s.w);
    const h = Math.abs(s.h);
    // A rectangle with no width or height: SVG skips <rect> then, the canvas strokes it as a line; draw that line.
    if (!w || !h) return `<path d="${roundRectPath({ x, y, w, h }, 0, 0)}" ${paint(s, s.strokeWidth, null)}/>`;
    const r = cornerRadii(s);
    // Dashed: a path from mid top edge, the same the canvas traces (shapeLook.traceRoundRect).
    if (s.dash?.length && s.stroke && s.strokeWidth > 0) return `<path d="${roundRectPath({ x, y, w, h }, r.rx, r.ry, true, s.smooth)}" ${paint(s, s.strokeWidth)}/>`;
    if (s.smooth && r.rx > 0 && r.ry > 0) return `<path d="${roundRectPath({ x, y, w, h }, r.rx, r.ry, false, s.smooth)}" ${paint(s, s.strokeWidth)}/>`;
    return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${r.rx > 0 && r.ry > 0 ? ` rx="${n(r.rx)}"${r.ry !== r.rx ? ` ry="${n(r.ry)}"` : ''}` : ''} ${paint(s, s.strokeWidth)}/>`;
  }
  if (s.type === 'ellipse') {
    return `<ellipse cx="${n(s.x + s.w / 2)}" cy="${n(s.y + s.h / 2)}" rx="${n(Math.abs(s.w / 2))}" ry="${n(Math.abs(s.h / 2))}" ${paint(s, s.strokeWidth)}/>`;
  }
  return `<line x1="${n(s.x)}" y1="${n(s.y)}" x2="${n(s.x + s.w)}" y2="${n(s.y + s.h)}" ${paint(s, s.strokeWidth, null)}/>`;
}

export function textSvg(l: TextLayer, t: { lines: string[]; width: number; lineHeightPx: number }, ascent: number, paths?: string[]): string {
  const anchor = l.align === 'center' ? 'middle' : l.align === 'right' ? 'end' : 'start';
  const ax = l.align === 'center' ? l.x + t.width / 2 : l.align === 'right' ? l.x + t.width : l.x;
  // Same vertical placement as the canvas renderer: glyphs centered in each line box.
  const pad = (t.lineHeightPx - l.fontSize) / 2;
  const spans = t.lines.map((line, i) => `<tspan x="${n(ax)}" y="${n(l.y + i * t.lineHeightPx + pad + ascent)}">${xmlEscape(line)}</tspan>`).join('');
  const spacing = l.letterSpacing ? ` letter-spacing="${n(l.letterSpacing)}"` : '';
  const fo = l.colorOpacity != null && l.colorOpacity < 1 ? ` fill-opacity="${n(Math.max(0, l.colorOpacity))}"` : '';
  const bars = decorationRects(l, t, ascent).map((r) => `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" fill="${xmlEscape(l.color)}"${fo}/>`).join('');
  const el = paths ? `<g fill="${xmlEscape(l.color)}"${fo}>${paths.map((d) => `<path d="${d}"/>`).join('')}</g>` : `<text xml:space="preserve" font-family="${xmlEscape(fontStack(l.fontFamily))}" font-size="${n(l.fontSize)}" font-weight="${l.fontWeight}"${l.italic ? ' font-style="italic"' : ''} fill="${xmlEscape(l.color)}"${fo} text-anchor="${anchor}"${spacing}>${spans}</text>`;
  return bars ? `<g>${el}${bars}</g>` : el;
}

export interface SvgViewport {
  width: number;
  height: number;
  box: { x: number; y: number; w: number; h: number };
}

const TEXT_ATTRS = new Set(['version', 'id', 'class', 'href', 'xlink:href', 'inkscape:label', 'font-family', 'aria-label', 'xml:space', 'encoding']);
/** Round every number with decimals inside attribute values (embedded images are left alone). */
export function roundSvgNumbers(svg: string, decimals: number): string {
  // Names, ids, links and the XML declaration are text, not geometry: "Version 1.25" and version="1.0" stay as written.
  return svg.replace(/(\s([\w:-]+)=")([^"]*)(")/g, (all, open: string, name: string, value: string, close: string) =>
    value.startsWith('data:') || TEXT_ATTRS.has(name) ? all : open + value.replace(/-?\d*\.\d+/g, (num) => String(+(+num).toFixed(decimals))) + close);
}

/** Smaller file: no editor-only attributes or namespaces, no whitespace between tags. */
export function minifySvg(svg: string): string {
  return svg.replace(/ (?:(?:inkscape|sodipodi):[\w-]+|data-ogs)="[^"]*"/g, '').replace(/ xmlns:(?:inkscape|sodipodi)="[^"]*"/g, '')
    // Only indentation (whitespace with a line break) goes: a lone space between tags can be text (xml:space).
    .replace(/>\s*\n\s*</g, '><').replace(/\n/g, '');
}

export interface SvgBuildOptions extends SvgOptions {
  /** Keep hidden layers, groups and shapes, marked display:none as Inkscape does (default: yes, unless minified). */
  hidden?: boolean;
  /** false: the file is read by something without filters (PDF), so every effect and blur becomes a picture of what
   *  it covers, in place, and the rest stays vector. */
  filters?: boolean;
  /** 'paths' draws text as outlines; fontFaces is the embedded @font-face CSS. */
  text?: 'fonts' | 'paths';
  fontFaces?: string;
  /** Verified layerId -> relative href map from syncBrandExportFolder; missing entries fall back to embedded pixels. */
  verifiedBrandHrefs?: ReadonlyMap<string, string>;
}

export async function docToSvg(doc: DesignDoc, deps: SvgDeps, viewport?: SvgViewport, options: SvgBuildOptions = {}): Promise<string> {
  if (!allFinite([doc.width, doc.height, viewport])) throw new Error('Cannot export SVG: the page size is not a finite number');
  // A shape or layer holding NaN or Infinity is left out and named, not the whole export failed (exportFinite.ts).
  const finite = finiteDoc(doc);
  if (finite.dropped.length) deps.notice?.(`${finite.dropped.join(', ')} had invalid numbers: left out of this file.`);
  doc = finite.doc;
  let svg = await buildSvg(doc, deps, viewport, options);
  if (options.decimals !== undefined) svg = roundSvgNumbers(svg, Math.max(0, Math.min(6, Math.round(options.decimals))));
  return options.minify ? minifySvg(svg) : svg;
}

async function buildSvg(doc: DesignDoc, deps: SvgDeps, viewport: SvgViewport | undefined, build: SvgBuildOptions): Promise<string> {
  const title = build.metadata !== false;
  const { width, height, box } = viewport ?? { width: doc.width, height: doc.height, box: { x: 0, y: 0, w: doc.width, h: doc.height } };
  const body: string[] = [], defs: string[] = [], skipped = new Set<string>(), unread: string[] = [];
  if (doc.background) body.push(`<rect width="${doc.width}" height="${doc.height}" fill="${xmlEscape(doc.background)}"/>`);
  // FX (ADR 0011): the same plan as the canvas. 'below' wraps everything before it, 'layer' wraps its target's content.
  const filtered = (content: string, fx: FxLayer, asLayer: boolean): string => {
    const id = `fx-${xmlEscape(fx.id)}`, f = noFilters ? { markup: '', skipped: noSvg(fx) } : fxFilter(fx, id, doc.width, doc.height);
    f.skipped.forEach((label) => skipped.add(label));
    const layerAttrs = asLayer ? ` id="${xmlEscape(fx.id)}" inkscape:groupmode="layer" inkscape:label="${xmlEscape(fx.name)}"` : '';
    if (!f.markup) return asLayer ? `<g${layerAttrs}>${content}</g>` : content;
    defs.push(f.markup);
    if (fx.opacity >= 1 && fx.blend === 'normal') return `<g${layerAttrs} filter="url(#${id})">${content}</g>`;
    // Mixed by opacity or blend: a filtered copy over the original (ids stay on the original only).
    const copy = content.replace(/ id="[^"]*"/g, '').replace(/ inkscape:groupmode="layer"/g, '');
    const style = fx.blend !== 'normal' ? ` style="mix-blend-mode:${fx.blend}"` : '';
    return `<g${layerAttrs}>${content}<g filter="url(#${id})" opacity="${n(fx.opacity)}"${style}>${copy}</g></g>`;
  };
  const keepHidden = build.hidden ?? !build.minify;
  // An effect SVG cannot say: what it covers becomes a picture with the effect in it, the rest of the file stays editable.
  const pictured: string[] = [];
  const noFilters = build.filters === false, kind = noFilters ? 'PDF' : 'SVG';
  const noSvg = (fx: FxLayer) => fx.ops.filter((o) => o.enabled && (noFilters || !FX_DEFS[o.kind].svg)).map((o) => FX_DEFS[o.kind].label);
  const picture = async (part: DesignDoc, what: string, lost: string[], area?: Box): Promise<string | null> => {
    const href = lost.length && deps.picture ? await deps.picture(part, area) : null;
    if (!href) return null;
    if (what) pictured.push(`${what} (${[...new Set(lost)].join(', ')})`);
    const at = area ? ` x="${n(area.x)}" y="${n(area.y)}"` : '';
    return `<image${at} width="${area?.w ?? doc.width}" height="${area?.h ?? doc.height}" preserveAspectRatio="none" href="${href}"/>`;
  };
  // Without filters, a blurred shape is a picture of that shape alone, cut to the reach of its blur.
  const blurred = new Map<string, string>(), unblurred: string[] = [];
  if (noFilters) for (const l of doc.layers) {
    if (l.type !== 'vector' || !l.visible) continue;
    for (const s of l.shapes) {
      if (!s.blur || s.blur <= 0 || s.hidden) continue;
      const r = blurRegion(s), x = Math.floor(r.x), y = Math.floor(r.y);
      const alone = { ...l, opacity: 1, blend: 'normal', pixelMask: undefined, strokes: [], objectGroups: [], shapes: [{ ...s, groupId: undefined }] } as Layer;
      const pic = await picture({ ...doc, background: null, layers: [alone] }, '', ['Blur'], { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y });
      if (pic) blurred.set(s.id, pic); else unblurred.push(s.name ?? 'a shape');
    }
  }
  if (blurred.size) pictured.push(`${blurred.size} blurred shape${blurred.size > 1 ? 's' : ''}`);
  const shapeOrPicture = blurred.size ? (s: VectorShape) => blurred.get(s.id) ?? shapeSvg(s) : shapeSvg;
  // A layer folder is written as Inkscape writes a layer with sublayers; the import reads it back as a folder.
  let folder: { id: string; from: number } | null = null;
  const closeFolder = () => {
    const g = folder && doc.groups?.find((x) => x.id === folder!.id);
    if (g && body.length > folder!.from) body.splice(folder!.from, body.length, `<g id="${xmlEscape(g.id)}" inkscape:groupmode="layer" inkscape:label="${xmlEscape(g.name)}">${body.slice(folder!.from).join('')}</g>`);
    folder = null;
  };
  for (const step of fxPlan(doc.layers, undefined, keepHidden)) {
    if ((step.t === 'below' ? undefined : step.layer.groupId) !== folder?.id) {
      closeFolder();
      if (step.t !== 'below' && step.layer.groupId) folder = { id: step.layer.groupId, from: body.length };
    }
    if (step.t === 'below') {
      const pic = await picture({ ...doc, layers: doc.layers.slice(0, doc.layers.indexOf(step.fx) + 1) }, `everything under “${step.fx.name}”`, noSvg(step.fx));
      body.splice(0, body.length, pic ? `<g id="${xmlEscape(step.fx.id)}" inkscape:groupmode="layer" inkscape:label="${xmlEscape(step.fx.name)}">${pic}</g>` : filtered(body.join(''), step.fx, true));
      continue;
    }
    const l = step.layer;
    let inner: string;
    const pic = step.t === 'clip' && l.visible ? await picture({ ...doc, background: null, layers: [{ ...l, opacity: 1, blend: 'normal' }, ...step.fx] }, `“${l.name}”`, step.fx.flatMap(noSvg)) : null;
    if (pic) inner = pic;
    else if (l.type === 'raster') {
      const linked = build.linkBrandAssets && l.libraryAsset
        ? (build.verifiedBrandHrefs ? build.verifiedBrandHrefs.get(l.id) ?? null : linkedBrandHref(l))
        : null;
      const href = linked ?? await deps.rasterHref(l);
      if (!href) { unread.push(l.name); continue; }
      inner = `<image x="${n(l.x)}" y="${n(l.y)}" width="${n(l.width)}" height="${n(l.height)}" preserveAspectRatio="none" href="${linked ? xmlEscape(href) : href}"/>`;
    } else if (l.type === 'vector') {
      // Pressure strokes become their filled outline: an editable path, not the original gesture.
      const strokes = await Promise.all((l.strokes ?? []).map((s) => strokeSvg(s)));
      inner = shapesSvgTree(keepHidden ? l : shownLayer(l), shapeOrPicture, xmlEscape) + strokes.join('');
      if (l.pixelMask) {
        const mask = l.pixelMask, href = await deps.rasterHref(mask);
        // Without its mask the layer would show what the mask hides: left out, and said.
        if (!href) { unread.push(l.name); continue; }
        const id = `mask-${xmlEscape(l.id)}`;
        const transform = mask.transform ? ` transform="matrix(${mask.transform.map(n).join(' ')})"` : '';
        inner = `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000" mask-type="alpha"><image x="${n(mask.x)}" y="${n(mask.y)}" width="${n(mask.width)}" height="${n(mask.height)}" preserveAspectRatio="none" href="${href}"${transform}/></mask></defs><g mask="url(#${id})">${inner}</g>`;
      }
    } else {
      const t = deps.layout(l);
      let paths: string[] | undefined;
      if (build.text === 'paths') {
        const woff = await deps.fontFile?.(l.fontFamily, l.fontWeight, l.italic);
        if (woff && canOutline(woff)) paths = await textPathData(woff, l, t, deps.ascent(l));
        else deps.notice?.(`“${l.fontFamily}” is a system font the app cannot read, so its text stays live text instead of paths.`);
      }
      inner = textSvg(l, t, deps.ascent(l), paths);
    }
    const css = [l.visible ? '' : 'display:none', l.blend !== 'normal' ? `mix-blend-mode:${l.blend}` : ''].filter(Boolean).join(';');
    const style = `${css ? ` style="${css}"` : ''}${l.locked ? ' sodipodi:insensitive="true"' : ''}`;
    const opacity = l.opacity < 1 ? ` opacity="${n(l.opacity)}"` : '';
    // A rotated or skewed image or text keeps its transform, as Inkscape writes it (inner group: the layer stays plain).
    if (!pic && l.transform && l.type !== 'vector') inner = `<g transform="matrix(${l.transform.map(n).join(' ')})">${inner}</g>`;
    // Its FX act on the content in page space, before the layer's own opacity and blend (as on the canvas).
    if (!pic && step.t === 'clip') inner = step.fx.reduce((acc, fx) => filtered(acc, fx, false), inner);
    body.push(`<g id="${xmlEscape(l.id)}" inkscape:groupmode="layer" inkscape:label="${xmlEscape(l.name)}"${opacity}${style}>${inner}</g>`);
  }
  closeFolder();
  if (pictured.length) deps.notice?.(`${kind} has no equivalent for ${noFilters ? 'blur and effects' : 'an effect'}, so these are pictures in this file: ${pictured.join('; ')}.`);
  if (unblurred.length) skipped.add(`the blur of ${unblurred.length} shape${unblurred.length > 1 ? 's' : ''}`);
  if (skipped.size) deps.notice?.(`${kind} has no equivalent for ${[...skipped].join(', ')}: left out of this file. PNG and JPG keep it.`);
  if (unread.length) deps.notice?.(`The pixels of ${unread.join(', ')} could not be read: left out of this file.`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="${width}" height="${height}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}">`,
    ...(title ? [`<title>${xmlEscape(doc.name)}</title>`] : []),
    // Content outside the page is cut, as in the editor.
    `<defs>${build.fontFaces ? `<style>${build.fontFaces}</style>` : ''}<clipPath id="page"><rect width="${doc.width}" height="${doc.height}"/></clipPath>${defs.join('')}</defs>`,
    `<g clip-path="url(#page)">${body.join('')}</g>`,
    '</svg>',
  ].join('\n');
}

/**
 * PDF from the same SVG (jsPDF + svg2pdf.js, loaded only when used). Shapes and images stay vector/embedded;
 * text uses the PDF standard fonts unless the family is embedded, so it may not match the design fonts.
 */
export async function svgToPdf(svg: string, width: number, height: number, page?: PdfPage, print?: PrintOptions, fonts: { family: string; weight: number; italic?: boolean; sfnt: Uint8Array }[] = []): Promise<Blob> {
  const [{ jsPDF, GState }, { svg2pdf }, { svgIntoPdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js'), import('./pdfLook')]);
  const el = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const layout = page ? pageLayout(page, width, height, print) : undefined;
  const pdf = new jsPDF({
    unit: 'px', format: layout ? [layout.pageWidth, layout.pageHeight] : [width, height],
    orientation: layout ? (layout.pageWidth >= layout.pageHeight ? 'landscape' : 'portrait') : width >= height ? 'landscape' : 'portrait', hotfixes: ['px_scaling'],
  });
  // Embedded fonts: one regular and one bold file per family, and their italics (jsPDF knows two weights).
  const registered = new Set<string>();
  for (const f of fonts) {
    const style = `${f.weight >= 600 ? 'bold' : ''}${f.italic ? 'italic' : ''}` || 'normal', key = `${f.family}|${style}`;
    if (registered.has(key)) continue;
    registered.add(key);
    pdf.addFileToVFS(`${key}.ttf`, base64(f.sfnt));
    pdf.addFont(`${key}.ttf`, f.family, style);
  }
  // svg2pdf reads computed styles: the SVG must be in the document while it converts.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden';
  host.appendChild(el);
  document.body.appendChild(host);
  try {
    const { trim } = layout ?? {};
    if (layout && trim) {
      // Artwork covers trim + bleed and is cut there, so nothing spills into the mark area.
      pdf.saveGraphicsState();
      pdf.rect(trim.x - layout.bleed, trim.y - layout.bleed, trim.w + 2 * layout.bleed, trim.h + 2 * layout.bleed, null);
      pdf.clip();
      pdf.discardPath();
    }
    // Group opacity, blend modes, masks and gradient alpha go in as PDF transparency groups (pdfLook.ts).
    await svgIntoPdf(pdf, GState as never, svg2pdf as never, el, layout ?? { x: 0, y: 0, width, height });
    if (layout && trim) {
      pdf.restoreGraphicsState();
      if (layout.marks) cropMarks(pdf, trim, layout.bleed);
    }
  } finally {
    host.remove();
  }
  return pdf.output('blob');
}

/** Registration-black lines (0.25 pt) at the trim corners, starting 2 mm beyond the bleed so they never print on the artwork. */
function cropMarks(pdf: { setDrawColor(c: number): void; setLineWidth(w: number): void; line(a: number, b: number, c: number, d: number): void }, trim: { x: number; y: number; w: number; h: number }, bleed: number) {
  const gap = bleed + MARK_OFFSET_MM * PX_PER_MM, len = MARK_LENGTH_MM * PX_PER_MM;
  pdf.setDrawColor(0);
  pdf.setLineWidth(0.25 * 96 / 72);
  for (const x of [trim.x, trim.x + trim.w]) for (const [y, dir] of [[trim.y, -1], [trim.y + trim.h, 1]] as const) {
    const out = x === trim.x ? -1 : 1;
    pdf.line(x, y + dir * gap, x, y + dir * (gap + len));
    pdf.line(x + out * gap, y, x + out * (gap + len), y);
  }
}
