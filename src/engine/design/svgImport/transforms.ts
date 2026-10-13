import { IDENTITY, multiply, type Mat } from '../matrix';

/* SVG transform lists and lengths, as 2D matrices in the app's convention ([a, b, c, d, e, f], matrix.ts). */

const UNITS: Record<string, number> = { px: 1, '': 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, q: 96 / 101.6 };

/** A length in user units (px); `ref` is what a percentage is a share of, `em` the font size. null when it is not a length. */
export function parseLength(text: string | null | undefined, ref = 0, em = 16): number | null {
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(%|em|ex|[a-zA-Z]*)\s*$/.exec(text ?? '');
  if (!m) return null;
  const v = Number(m[1]), u = m[2].toLowerCase();
  if (u === '%') return (v * ref) / 100;
  if (u === 'em') return v * em;
  if (u === 'ex') return v * em * 0.5;
  return u in UNITS ? v * UNITS[u] : null;
}

/** Numbers separated by spaces or commas. */
export function numbers(text: string | null | undefined): number[] {
  return (text?.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
}

/** A transform attribute: matrix, translate, scale, rotate, skewX, skewY in order. Invalid lists are the identity. */
export function parseTransform(text: string | null | undefined): Mat {
  if (!text) return IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let m: Mat = IDENTITY, used = 0, hit: RegExpExecArray | null;
  while ((hit = re.exec(text))) {
    used += hit[0].length;
    const a = numbers(hit[2]);
    let t: Mat | null = null;
    switch (hit[1]) {
      case 'matrix': if (a.length === 6) t = a as Mat; break;
      case 'translate': if (a.length >= 1) t = [1, 0, 0, 1, a[0], a[1] ?? 0]; break;
      case 'scale': if (a.length >= 1) t = [a[0], 0, 0, a[1] ?? a[0], 0, 0]; break;
      case 'rotate': if (a.length === 1 || a.length === 3) {
        const r = (a[0] * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), cx = a[1] ?? 0, cy = a[2] ?? 0;
        t = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
      } break;
      case 'skewX': if (a.length === 1) t = [1, 0, Math.tan((a[0] * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': if (a.length === 1) t = [1, Math.tan((a[0] * Math.PI) / 180), 0, 1, 0, 0]; break;
    }
    if (!t) return IDENTITY;
    m = multiply(m, t);
  }
  // Anything left over that is not separators means a malformed list: ignore it whole, as renderers do.
  return text.replace(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g, '').replace(/[\s,]/g, '') ? IDENTITY : m;
}

/**
 * The matrix from an SVG's user units to its page (the width × height it declares): the viewBox mapped with
 * preserveAspectRatio (default xMidYMid meet). Without a width or height, the viewBox's own size is the page.
 */
export function pageSetup(svg: Element): { width: number; height: number; matrix: Mat } {
  const vb = numbers(svg.getAttribute('viewBox'));
  const hasVb = vb.length === 4 && vb[2] > 0 && vb[3] > 0;
  const w0 = parseLength(svg.getAttribute('width'), hasVb ? vb[2] : 0), h0 = parseLength(svg.getAttribute('height'), hasVb ? vb[3] : 0);
  const width = w0 && w0 > 0 ? w0 : hasVb ? vb[2] : 1000, height = h0 && h0 > 0 ? h0 : hasVb ? vb[3] : 1000;
  if (!hasVb) return { width, height, matrix: IDENTITY };
  return { width, height, matrix: viewBoxMatrix(vb, width, height, svg.getAttribute('preserveAspectRatio')) };
}

export function viewBoxMatrix(vb: number[], width: number, height: number, par: string | null): Mat {
  const [minX, minY, vw, vh] = vb, sx = width / vw, sy = height / vh;
  const p = (par ?? 'xMidYMid meet').trim().split(/\s+/);
  if (p[0] === 'none') return [sx, 0, 0, sy, -minX * sx, -minY * sy];
  const s = p[1] === 'slice' ? Math.max(sx, sy) : Math.min(sx, sy);
  const ax = /xMin/.test(p[0]) ? 0 : /xMax/.test(p[0]) ? 1 : 0.5, ay = /YMin/.test(p[0]) ? 0 : /YMax/.test(p[0]) ? 1 : 0.5;
  return [s, 0, 0, s, (width - vw * s) * ax - minX * s, (height - vh * s) * ay - minY * s];
}
