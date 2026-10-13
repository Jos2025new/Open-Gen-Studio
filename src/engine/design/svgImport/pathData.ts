import type { Mat } from '../matrix';
import { apply } from '../matrix';

/*
 * SVG path data → the absolute subset the app's path shapes use (M L C Q Z; path.ts). Relative commands, H V, S T
 * and arcs (A) are rewritten: arcs become cubic Béziers (one per ≤ 90°, the standard endpoint-to-centre
 * conversion of the SVG spec, appendix F.6). Transforms are applied to the points here, so a path reaches the
 * model already in page coordinates. Returns null on malformed data.
 */

type Box = { x: number; y: number; w: number; h: number };
const ARGC: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const NUM = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;
const r3 = (v: number) => String(Math.round(v * 1000) / 1000);

/** Tokens: command letters and numbers. In an arc the two flags are single 0/1 digits and may be glued to what follows. */
function tokenize(d: string): Array<string | number> | null {
  const out: Array<string | number> = [];
  let i = 0, cmd = '', argIndex = 0;
  while (i < d.length) {
    const ch = d[i];
    if (/[\s,]/.test(ch)) { i++; continue; }
    if (/[A-Za-z]/.test(ch)) {
      if (!(ch.toUpperCase() in ARGC)) return null;
      cmd = ch; argIndex = 0; out.push(ch); i++; continue;
    }
    if (cmd.toUpperCase() === 'A' && (argIndex % 7 === 3 || argIndex % 7 === 4)) {
      if (ch !== '0' && ch !== '1') return null;
      out.push(Number(ch)); i++; argIndex++; continue;
    }
    const m = NUM.exec(d.slice(i));
    if (!m) return null;
    out.push(Number(m[0])); i += m[0].length; argIndex++;
  }
  return out;
}

/** One arc as cubic Béziers from (x0, y0), appended to `out` as absolute C commands. */
function arcToCubics(out: Array<[number, number, number, number, number, number]>, x0: number, y0: number, rx: number, ry: number, rotDeg: number, large: number, sweep: number, x: number, y: number): void {
  if (x0 === x && y0 === y) return;
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry) { out.push([x0, y0, x, y, x, y]); return; } // a zero radius is a straight line
  const phi = (rotDeg * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x0 - x) / 2, dy = (y0 - y) / 2;
  const x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1, den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1) / ry, cyp = (-co * ry * x1) / rx;
  const cx = cp * cxp - sp * cyp + (x0 + x) / 2, cy = sp * cxp + cp * cyp + (y0 + y) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let dt = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9)), step = dt / n, k = (4 / 3) * Math.tan(step / 4);
  const pt = (t: number): [number, number] => [cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp];
  const dv = (t: number): [number, number] => [-rx * Math.sin(t) * cp - ry * Math.cos(t) * sp, -rx * Math.sin(t) * sp + ry * Math.cos(t) * cp];
  for (let i = 0; i < n; i++) {
    const a = t1 + i * step, b = a + step, p0 = pt(a), p1 = pt(b), d0 = dv(a), d1 = dv(b);
    out.push([p0[0] + k * d0[0], p0[1] + k * d0[1], p1[0] - k * d1[0], p1[1] - k * d1[1], i === n - 1 ? x : p1[0], i === n - 1 ? y : p1[1]]);
  }
}

export interface NormalPath { d: string; box: Box; subpaths: number }

/** Absolute M L C Q Z data of `d`, every point moved by `m`; null when `d` is malformed or has no drawing. */
export function normalizePath(d: string, m: Mat = [1, 0, 0, 1, 0, 0]): NormalPath | null {
  const tokens = tokenize(d);
  if (!tokens || !tokens.length || typeof tokens[0] !== 'string' || !/^[Mm]$/.test(tokens[0])) return null;
  const out: string[] = [], xs: number[] = [], ys: number[] = [];
  const P = (x: number, y: number): string => { const [px, py] = apply(m, x, y); xs.push(px); ys.push(py); return `${r3(px)} ${r3(py)}`; };
  let i = 0, cmd = '', cx = 0, cy = 0, sx = 0, sy = 0, lastC: [number, number] | null = null, lastQ: [number, number] | null = null, subpaths = 0, open = false;
  while (i < tokens.length) {
    if (typeof tokens[i] === 'string') { cmd = tokens[i++] as string; if (cmd === 'Z' || cmd === 'z') { if (open) out.push('Z'); open = false; cx = sx; cy = sy; lastC = lastQ = null; continue; } }
    else if (!cmd || cmd === 'Z' || cmd === 'z') return null;
    const up = cmd.toUpperCase(), rel = cmd !== up, n = ARGC[up];
    const a = tokens.slice(i, i + n);
    if (a.length < n || a.some((v) => typeof v !== 'number')) return null;
    const v = a as number[];
    i += n;
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    // After Z a drawing command without M starts a new subpath at the old start point.
    if (!open && up !== 'M') { out.push(`M ${P(cx, cy)}`); open = true; subpaths++; sx = cx; sy = cy; }
    let nextC: [number, number] | null = null, nextQ: [number, number] | null = null;
    switch (up) {
      case 'M': cx = v[0] + ox; cy = v[1] + oy; sx = cx; sy = cy; out.push(`M ${P(cx, cy)}`); open = true; subpaths++; cmd = rel ? 'l' : 'L'; break; // further pairs are lineto
      case 'L': cx = v[0] + ox; cy = v[1] + oy; out.push(`L ${P(cx, cy)}`); break;
      case 'H': cx = v[0] + ox; out.push(`L ${P(cx, cy)}`); break;
      case 'V': cy = v[0] + oy; out.push(`L ${P(cx, cy)}`); break;
      case 'C': out.push(`C ${P(v[0] + ox, v[1] + oy)} ${P(v[2] + ox, v[3] + oy)} ${P(v[4] + ox, v[5] + oy)}`); nextC = [v[2] + ox, v[3] + oy]; cx = v[4] + ox; cy = v[5] + oy; break;
      case 'S': { const r: [number, number] = lastC ? [2 * cx - lastC[0], 2 * cy - lastC[1]] : [cx, cy]; out.push(`C ${P(r[0], r[1])} ${P(v[0] + ox, v[1] + oy)} ${P(v[2] + ox, v[3] + oy)}`); nextC = [v[0] + ox, v[1] + oy]; cx = v[2] + ox; cy = v[3] + oy; break; }
      case 'Q': out.push(`Q ${P(v[0] + ox, v[1] + oy)} ${P(v[2] + ox, v[3] + oy)}`); nextQ = [v[0] + ox, v[1] + oy]; cx = v[2] + ox; cy = v[3] + oy; break;
      case 'T': { const q: [number, number] = lastQ ? [2 * cx - lastQ[0], 2 * cy - lastQ[1]] : [cx, cy]; out.push(`Q ${P(q[0], q[1])} ${P(v[0] + ox, v[1] + oy)}`); nextQ = q; cx = v[0] + ox; cy = v[1] + oy; break; }
      case 'A': {
        const segs: Array<[number, number, number, number, number, number]> = [];
        arcToCubics(segs, cx, cy, v[0], v[1], v[2], v[3], v[4], v[5] + ox, v[6] + oy);
        for (const s of segs) out.push(`C ${P(s[0], s[1])} ${P(s[2], s[3])} ${P(s[4], s[5])}`);
        cx = v[5] + ox; cy = v[6] + oy; break;
      }
    }
    lastC = nextC; lastQ = nextQ;
  }
  if (!xs.length || xs.some((x) => !Number.isFinite(x)) || ys.some((y) => !Number.isFinite(y))) return null;
  const x = Math.min(...xs), y = Math.min(...ys);
  return { d: out.join(' '), box: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }, subpaths };
}
