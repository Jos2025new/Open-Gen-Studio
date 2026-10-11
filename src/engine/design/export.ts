import { pathTransform } from './path';
import { shapeMatrix } from './shapeTransform';
import { multiply } from './matrix';
import { blurFilterSvg, cornerRadii, roundRectPath, strokeLookSvg } from './shapeLook';
import type { DesignDoc, Layer, TextLayer, VectorShape } from '../types';
import { fontStack } from './doc';
import { strokeSvg } from './brushTextures';
import { fxPlan } from '../fx/plan';
import { fxFilter } from '../fx/svg';
import type { FxLayer } from '../fx/types';

/*
 * Vector export. Each layer stays an editable object: shapes as SVG shapes, text as <text> (editable when the
 * font is installed), images as embedded PNG (never a blob: URL). Layers become Inkscape layers (inkscape:label)
 * so the structure survives. Blend modes use CSS mix-blend-mode; how far other editors honor it is not verified.
 * FX layers become SVG filters (fx/svg.ts).
 */

export type ExportFormat = 'png' | 'jpg' | 'svg' | 'pdf';

export interface SvgDeps {
  /** Data URL of a raster layer's pixels (as displayed). Null when the layer has no pixels. */
  rasterHref: (layer: Extract<Layer, { type: 'raster' }>) => Promise<string | null>;
  /** Wrapped lines of a text layer, as the canvas renderer lays them out. */
  layout: (layer: TextLayer) => { lines: string[]; width: number; lineHeightPx: number };
  /** Distance from the top of the em box to the baseline, in px (canvas 'top' baseline → SVG alphabetic). */
  ascent: (layer: TextLayer) => number;
  /** What the SVG could not keep (an FX with no SVG equivalent), said once per export. */
  notice?: (message: string) => void;
}

export function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/** Numbers without float noise (0.30000000000000004 → 0.3). */
export function n(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

function paint(s: VectorShape, strokeWidth: number, fill = s.fill): string {
  return `fill="${fill ? xmlEscape(fill) : 'none'}"${s.stroke && strokeWidth > 0 ? ` stroke="${xmlEscape(s.stroke)}" stroke-width="${n(strokeWidth)}"${strokeLookSvg(s, strokeWidth)}` : ''}`;
}

/** A shape, wrapped with its own blur filter when it has one (shapeLook.ts: Inkscape's 2.4σ margin). */
export function shapeSvg(s: VectorShape): string {
  const body = shapeBody(s);
  if (!s.blur || s.blur <= 0) return body;
  const id = `blur-${xmlEscape(s.id)}`;
  return `<g filter="url(#${id})"><defs>${blurFilterSvg(id, s)}</defs>${body}</g>`;
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
    return `<path d="${xmlEscape(s.d ?? '')}" transform="matrix(${m.map((v) => String(+v.toFixed(6))).join(' ')})"${s.nodeTypes ? ` sodipodi:nodetypes="${xmlEscape(s.nodeTypes)}"` : ''} ${paint(s, s.strokeWidth / k)}/>`;
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
    if (s.dash?.length && s.stroke && s.strokeWidth > 0) return `<path d="${roundRectPath({ x, y, w, h }, r.rx, r.ry, true)}" ${paint(s, s.strokeWidth)}/>`;
    return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${r.rx > 0 && r.ry > 0 ? ` rx="${n(r.rx)}"${r.ry !== r.rx ? ` ry="${n(r.ry)}"` : ''}` : ''} ${paint(s, s.strokeWidth)}/>`;
  }
  if (s.type === 'ellipse') {
    return `<ellipse cx="${n(s.x + s.w / 2)}" cy="${n(s.y + s.h / 2)}" rx="${n(Math.abs(s.w / 2))}" ry="${n(Math.abs(s.h / 2))}" ${paint(s, s.strokeWidth)}/>`;
  }
  return `<line x1="${n(s.x)}" y1="${n(s.y)}" x2="${n(s.x + s.w)}" y2="${n(s.y + s.h)}" ${paint(s, s.strokeWidth, null)}/>`;
}

export function textSvg(l: TextLayer, t: { lines: string[]; width: number; lineHeightPx: number }, ascent: number): string {
  const anchor = l.align === 'center' ? 'middle' : l.align === 'right' ? 'end' : 'start';
  const ax = l.align === 'center' ? l.x + t.width / 2 : l.align === 'right' ? l.x + t.width : l.x;
  // Same vertical placement as the canvas renderer: glyphs centered in each line box.
  const pad = (t.lineHeightPx - l.fontSize) / 2;
  const spans = t.lines.map((line, i) => `<tspan x="${n(ax)}" y="${n(l.y + i * t.lineHeightPx + pad + ascent)}">${xmlEscape(line)}</tspan>`).join('');
  const spacing = l.letterSpacing ? ` letter-spacing="${n(l.letterSpacing)}"` : '';
  return `<text xml:space="preserve" font-family="${xmlEscape(fontStack(l.fontFamily))}" font-size="${n(l.fontSize)}" font-weight="${l.fontWeight}" fill="${xmlEscape(l.color)}" text-anchor="${anchor}"${spacing}>${spans}</text>`;
}

export async function docToSvg(doc: DesignDoc, deps: SvgDeps): Promise<string> {
  const body: string[] = [], defs: string[] = [], skipped = new Set<string>();
  if (doc.background) body.push(`<rect width="${doc.width}" height="${doc.height}" fill="${xmlEscape(doc.background)}"/>`);
  // FX (ADR 0011): the same plan as the canvas. 'below' wraps everything before it, 'layer' wraps its target's content.
  const filtered = (content: string, fx: FxLayer, asLayer: boolean): string => {
    const id = `fx-${xmlEscape(fx.id)}`, f = fxFilter(fx, id, doc.width, doc.height);
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
  for (const step of fxPlan(doc.layers)) {
    if (step.t === 'below') {
      body.splice(0, body.length, filtered(body.join(''), step.fx, true));
      continue;
    }
    const l = step.layer;
    let inner: string;
    if (l.type === 'raster') {
      const href = await deps.rasterHref(l);
      if (!href) continue;
      inner = `<image x="${n(l.x)}" y="${n(l.y)}" width="${n(l.width)}" height="${n(l.height)}" preserveAspectRatio="none" href="${href}"/>`;
    } else if (l.type === 'vector') {
      // Pressure strokes become their filled outline: an editable path, not the original gesture.
      const strokes = await Promise.all((l.strokes ?? []).map((s) => strokeSvg(s)));
      inner = l.shapes.map(shapeSvg).join('') + strokes.join('');
      if (l.pixelMask) {
        const mask = l.pixelMask, href = await deps.rasterHref(mask);
        if (!href) continue;
        const id = `mask-${xmlEscape(l.id)}`;
        const transform = mask.transform ? ` transform="matrix(${mask.transform.map(n).join(' ')})"` : '';
        inner = `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000" style="mask-type:alpha"><image x="${n(mask.x)}" y="${n(mask.y)}" width="${n(mask.width)}" height="${n(mask.height)}" preserveAspectRatio="none" href="${href}"${transform}/></mask></defs><g mask="url(#${id})">${inner}</g>`;
      }
    } else {
      inner = textSvg(l, deps.layout(l), deps.ascent(l));
    }
    const style = l.blend !== 'normal' ? ` style="mix-blend-mode:${l.blend}"` : '';
    const opacity = l.opacity < 1 ? ` opacity="${n(l.opacity)}"` : '';
    // A rotated or skewed image or text keeps its transform, as Inkscape writes it (inner group: the layer stays plain).
    if (l.transform && l.type !== 'vector') inner = `<g transform="matrix(${l.transform.map(n).join(' ')})">${inner}</g>`;
    // Its FX act on the content in page space, before the layer's own opacity and blend (as on the canvas).
    if (step.t === 'clip') inner = step.fx.reduce((acc, fx) => filtered(acc, fx, false), inner);
    body.push(`<g id="${xmlEscape(l.id)}" inkscape:groupmode="layer" inkscape:label="${xmlEscape(l.name)}"${opacity}${style}>${inner}</g>`);
  }
  if (skipped.size) deps.notice?.(`SVG has no equivalent for ${[...skipped].join(', ')}: left out of this file. PNG and JPG keep it.`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">`,
    `<title>${xmlEscape(doc.name)}</title>`,
    // Content outside the page is cut, as in the editor.
    `<defs><clipPath id="page"><rect width="${doc.width}" height="${doc.height}"/></clipPath>${defs.join('')}</defs>`,
    `<g clip-path="url(#page)">${body.join('')}</g>`,
    '</svg>',
  ].join('\n');
}

/**
 * PDF from the same SVG (jsPDF + svg2pdf.js, loaded only when used). Shapes and images stay vector/embedded;
 * text uses the PDF standard fonts unless the family is embedded, so it may not match the design fonts.
 */
export async function svgToPdf(svg: string, width: number, height: number): Promise<Blob> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const el = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const pdf = new jsPDF({ unit: 'px', format: [width, height], orientation: width >= height ? 'landscape' : 'portrait', hotfixes: ['px_scaling'] });
  // svg2pdf reads computed styles: the SVG must be in the document while it converts.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden';
  host.appendChild(el);
  document.body.appendChild(host);
  try {
    await svg2pdf(el, pdf, { x: 0, y: 0, width, height });
  } finally {
    host.remove();
  }
  return pdf.output('blob');
}
