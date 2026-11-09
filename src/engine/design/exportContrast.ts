import type { DesignDoc } from '../types';

type Rgb = [number, number, number];
function parse(color: string | null | undefined): Rgb | null {
  const m = /^#([\da-f]{3}|[\da-f]{6})(?:[\da-f]{2})?$/i.exec(color?.trim() ?? '');
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}
const lum = ([r, g, b]: Rgb) => [r, g, b].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
const name = (l: number) => (l > 0.85 ? 'white' : l < 0.05 ? 'black' : 'similar');

/**
 * Says when everything drawn is about the colour of the page it lands on, so the file would look empty. Only plain
 * colours are judged (gradients, pictures and unknown formats count as visible). `page` is the colour behind the art.
 */
export function lowContrastNotice(doc: DesignDoc, page: string | null): string | undefined {
  const bg = parse(page);
  if (!bg) return;
  const colors: Array<string | null | undefined> = [];
  for (const l of doc.layers) {
    if (!l.visible || l.type === 'fx') continue;
    if (l.type === 'raster') return;
    if (l.type === 'text') colors.push(l.color);
    else {
      for (const s of l.shapes) {
        if (s.fillGradient || s.strokeGradient) return;
        colors.push(s.fill);
        if (s.strokeWidth > 0) colors.push(s.stroke);
      }
      for (const s of l.strokes ?? []) colors.push(s.color);
      if (l.pixelMask) return;
    }
  }
  const ink = colors.filter(Boolean).map(parse);
  if (!ink.length || ink.some((c) => !c)) return;
  const bgL = lum(bg);
  const worst = Math.max(...(ink as Rgb[]).map((c) => { const a = lum(c), hi = Math.max(a, bgL), lo = Math.min(a, bgL); return (hi + 0.05) / (lo + 0.05); }));
  if (worst >= 1.5) return;
  const a = name(lum((ink as Rgb[])[0])), b = name(bgL);
  return a !== 'similar' && b !== 'similar' && a === b
    ? `Your design is ${a} on a ${b} page and will not be visible. Change the background or the paper color.`
    : 'Your design has almost the same color as the page and may not be visible. Change the background or the paper color.';
}
