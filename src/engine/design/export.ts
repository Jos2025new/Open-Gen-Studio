import type { DesignDoc, Layer, TextLayer, VectorShape } from '../types';
import { fontStack } from './doc';
import { strokeSvg } from './brushTextures';

/*
 * Vector export. Each layer stays an editable object: shapes as SVG shapes, text as <text> (editable when the
 * font is installed), images as embedded PNG (never a blob: URL). Layers become Inkscape layers (inkscape:label)
 * so the structure survives. Blend modes use CSS mix-blend-mode; how far other editors honor it is not verified.
 */

export type ExportFormat = 'png' | 'jpg' | 'svg' | 'pdf';

export interface SvgDeps {
  /** Data URL of a raster layer's pixels (as displayed). Null when the layer has no pixels. */
  rasterHref: (layer: Extract<Layer, { type: 'raster' }>) => Promise<string | null>;
  /** Wrapped lines of a text layer, as the canvas renderer lays them out. */
  layout: (layer: TextLayer) => { lines: string[]; width: number; lineHeightPx: number };
  /** Distance from the top of the em box to the baseline, in px (canvas 'top' baseline → SVG alphabetic). */
  ascent: (layer: TextLayer) => number;
}

export function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/** Numbers without float noise (0.30000000000000004 → 0.3). */
export function n(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

function paint(fill: string | null, stroke: string | null, strokeWidth: number): string {
  return `fill="${fill ? xmlEscape(fill) : 'none'}"${stroke && strokeWidth > 0 ? ` stroke="${xmlEscape(stroke)}" stroke-width="${n(strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"` : ''}`;
}

export function shapeSvg(s: VectorShape): string {
  if (s.type === 'rect') {
    const x = Math.min(s.x, s.x + s.w);
    const y = Math.min(s.y, s.y + s.h);
    const w = Math.abs(s.w);
    const h = Math.abs(s.h);
    const r = Math.min(s.radius, w / 2, h / 2);
    return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${r > 0 ? ` rx="${n(r)}"` : ''} ${paint(s.fill, s.stroke, s.strokeWidth)}/>`;
  }
  if (s.type === 'ellipse') {
    return `<ellipse cx="${n(s.x + s.w / 2)}" cy="${n(s.y + s.h / 2)}" rx="${n(Math.abs(s.w / 2))}" ry="${n(Math.abs(s.h / 2))}" ${paint(s.fill, s.stroke, s.strokeWidth)}/>`;
  }
  return `<line x1="${n(s.x)}" y1="${n(s.y)}" x2="${n(s.x + s.w)}" y2="${n(s.y + s.h)}" ${paint(null, s.stroke, s.strokeWidth)}/>`;
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
  const body: string[] = [];
  if (doc.background) body.push(`<rect width="${doc.width}" height="${doc.height}" fill="${xmlEscape(doc.background)}"/>`);
  for (const l of doc.layers) {
    if (!l.visible || l.opacity <= 0) continue;
    let inner: string;
    if (l.type === 'raster') {
      const href = await deps.rasterHref(l);
      if (!href) continue;
      inner = `<image x="${n(l.x)}" y="${n(l.y)}" width="${n(l.width)}" height="${n(l.height)}" preserveAspectRatio="none" href="${href}"/>`;
    } else if (l.type === 'vector') {
      // Pressure strokes become their filled outline: an editable path, not the original gesture.
      const strokes = await Promise.all((l.strokes ?? []).map((s) => strokeSvg(s)));
      inner = l.shapes.map(shapeSvg).join('') + strokes.join('');
    } else {
      inner = textSvg(l, deps.layout(l), deps.ascent(l));
    }
    const style = l.blend !== 'normal' ? ` style="mix-blend-mode:${l.blend}"` : '';
    const opacity = l.opacity < 1 ? ` opacity="${n(l.opacity)}"` : '';
    body.push(`<g id="${xmlEscape(l.id)}" inkscape:groupmode="layer" inkscape:label="${xmlEscape(l.name)}"${opacity}${style}>${inner}</g>`);
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">`,
    `<title>${xmlEscape(doc.name)}</title>`,
    // Content outside the page is cut, as in the editor.
    `<defs><clipPath id="page"><rect width="${doc.width}" height="${doc.height}"/></clipPath></defs>`,
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
