import { createCanvas, ctx2d } from '../../lib/media';
import { fontStack } from './doc';
import type { TextLayer } from '../types';

let measureCtx: CanvasRenderingContext2D | null = null;

function measurer(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = ctx2d(createCanvas(8, 8));
  return measureCtx;
}

export function fontFor(l: Pick<TextLayer, 'fontWeight' | 'fontSize' | 'fontFamily'>): string {
  return `${l.fontWeight} ${l.fontSize}px ${fontStack(l.fontFamily)}`;
}

export function applyLetterSpacing(ctx: CanvasRenderingContext2D, px: number): void {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in c) c.letterSpacing = `${px}px`;
}

/** The text as shown: UPPER, lower or Title Case (first letter of each word; the rest as typed). */
export function applyTextCase(text: string, textCase?: TextLayer['textCase']): string {
  if (textCase === 'upper') return text.toUpperCase();
  if (textCase === 'lower') return text.toLowerCase();
  if (textCase === 'title') return text.replace(/(^|\s)(\p{L})/gu, (_m, sp: string, c: string) => sp + c.toUpperCase());
  return text;
}

/** Underline and strikethrough bars of a laid-out text, in page px: the one geometry for canvas and SVG. */
export function decorationRects(l: TextLayer, t: { lines: string[]; width: number; lineHeightPx: number }, ascent: number): Array<{ x: number; y: number; w: number; h: number }> {
  if (!l.underline && !l.strike) return [];
  const ctx = measurer();
  ctx.font = fontFor(l);
  applyLetterSpacing(ctx, l.letterSpacing);
  const thick = Math.max(1, l.fontSize / 16), pad = (t.lineHeightPx - l.fontSize) / 2, out: Array<{ x: number; y: number; w: number; h: number }> = [];
  t.lines.forEach((line, i) => {
    const w = ctx.measureText(line).width;
    if (!line.trim() || w <= 0) return;
    const ax = l.align === 'center' ? l.x + t.width / 2 : l.align === 'right' ? l.x + t.width : l.x;
    const x = l.align === 'center' ? ax - w / 2 : l.align === 'right' ? ax - w : ax;
    const base = l.y + i * t.lineHeightPx + pad + ascent;
    if (l.underline) out.push({ x, y: base + l.fontSize * 0.1, w, h: thick });
    if (l.strike) out.push({ x, y: base - l.fontSize * 0.3 - thick / 2, w, h: thick });
  });
  return out;
}

/** Draw the bars on the canvas, in the text's color (fillStyle is already it). */
export function drawTextDecoration(ctx: CanvasRenderingContext2D, l: TextLayer, t: { lines: string[]; width: number; lineHeightPx: number }): void {
  if (l.underline || l.strike) for (const r of decorationRects(l, t, textAscent(l))) ctx.fillRect(r.x, r.y, r.w, r.h);
}

export interface TextLayout {
  lines: string[];
  width: number;
  height: number;
  lineHeightPx: number;
}

/** Word-wrap a text layer to its box width. */
export function layoutText(l: TextLayer): TextLayout {
  const ctx = measurer();
  ctx.font = fontFor(l);
  applyLetterSpacing(ctx, l.letterSpacing);
  const maxW = l.width > 0 ? l.width : Infinity;
  const lines: string[] = [];
  for (const para of applyTextCase(l.text, l.textCase).split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const test = line + w;
      if (line && ctx.measureText(test.trimEnd()).width > maxW && w.trim()) {
        lines.push(line.trimEnd());
        line = w.trimStart();
      } else {
        line = test;
      }
    }
    lines.push(line.trimEnd());
  }
  const lineHeightPx = l.fontSize * l.lineHeight;
  const width = l.width > 0 ? l.width : Math.max(1, ...lines.map((s) => ctx.measureText(s).width));
  return { lines, width, height: Math.max(lineHeightPx, lines.length * lineHeightPx), lineHeightPx };
}

/** Top of the em box to the alphabetic baseline: where SVG places the baseline for the canvas 'top' layout. */
export function textAscent(l: TextLayer): number {
  const ctx = measurer();
  ctx.font = fontFor(l);
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText('Mg') as TextMetrics & { emHeightAscent?: number };
  return m.emHeightAscent ?? m.fontBoundingBoxAscent ?? l.fontSize * 0.8;
}
