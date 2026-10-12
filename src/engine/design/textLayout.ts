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
  for (const para of l.text.split('\n')) {
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
