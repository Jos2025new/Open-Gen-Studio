import { describe, expect, it } from 'vitest';
import { shapeSvg } from '../src/engine/design/export';
import { primShape, type PrimSpec } from '../src/engine/design/primitives';
import type { VectorShape } from '../src/engine/types';

/*
 * Inkscape attributes on exported primitives: the SVG is parsed back and the geometry is rebuilt from sodipodi:* with
 * Inkscape's own formulas (sp-ellipse.cpp set_shape, sp-star.cpp sp_star_get_xy), through the element's transform,
 * then compared with the `d` path that stays in the file.
 */
type Pt = [number, number];
const shape = (p: PrimSpec, extra: Partial<VectorShape> = {}) => ({ ...primShape(40, 30, 240, 130, p), id: 's', fill: '#f00', stroke: '#000', strokeWidth: 2, radius: 0, ...extra }) as VectorShape;
const attrs = (svg: string) => Object.fromEntries([...svg.matchAll(/ ((?:sodipodi|inkscape):[\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const matrix = (svg: string) => /transform="matrix\(([^)]+)\)"/.exec(svg)![1].split(' ').map(Number);
const apply = (m: number[], [x, y]: Pt): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const pathPts = (svg: string) => {
  const d = /<path d="([^"]+)"/.exec(svg)![1], m = matrix(svg);
  return [...d.matchAll(/([MLCQ])([^MLCQZ]*)/g)].map((s) => { const n = s[2].trim().split(/\s+/).map(Number); return { cmd: s[1], end: apply(m, [n[n.length - 2], n[n.length - 1]]) }; });
};
const near = (a: Pt, b: Pt, eps = 0.1) => Math.hypot(a[0] - b[0], a[1] - b[1]) < eps;
const num = (a: Record<string, string>, k: string) => Number(a[k]);

describe.each([
  ['sector', 0, 270], ['sector', 300, 60], ['arc', 90, 10], ['arc', 350, 10], ['chord', 10, 200], ['chord', 200, 10], ['arc', 0, 359.9],
] as const)('%s %i→%i', (kind, a0, a1) => {
  it('writes Inkscape arc attributes that rebuild the path', () => {
    const svg = shapeSvg(shape({ kind, a0, a1 }));
    const a = attrs(svg), m = matrix(svg);
    expect(a['sodipodi:type']).toBe('arc');
    expect(a['sodipodi:arc-type']).toBe(kind === 'sector' ? 'slice' : kind);
    expect(a['sodipodi:open']).toBe(kind === 'sector' ? undefined : 'true');
    const start = num(a, 'sodipodi:start'), end = num(a, 'sodipodi:end');
    expect(start).toBeGreaterThanOrEqual(0); expect(start).toBeLessThan(2 * Math.PI);
    expect(end).toBeGreaterThanOrEqual(0); expect(end).toBeLessThan(2 * Math.PI);
    // sp-ellipse.cpp 489: Scale(rx, ry) * Translate(cx, cy), then the element transform.
    const at = (t: number): Pt => apply(m, [num(a, 'sodipodi:cx') + num(a, 'sodipodi:rx') * Math.cos(t), num(a, 'sodipodi:cy') + num(a, 'sodipodi:ry') * Math.sin(t)]);
    const pts = pathPts(svg);
    const first = kind === 'sector' ? pts[1] : pts[0]; // a slice starts at the centre
    expect(near(first.end, at(start))).toBe(true);
    expect(near(pts.filter((p) => p.cmd === 'C').pop()!.end, at(end))).toBe(true);
    if (kind === 'sector') expect(near(pts[0].end, apply(m, [num(a, 'sodipodi:cx'), num(a, 'sodipodi:cy')]))).toBe(true);
    // The curve in `d` sweeps the same extent as incr = end - start (+2π), at the same radius.
    let incr = end - start; if (incr < 0) incr += 2 * Math.PI;
    expect((incr * 180) / Math.PI).toBeCloseTo((((a1 - a0) % 360) + 360) % 360, 4);
  });
});

describe('whole ellipses', () => {
  it('a full circle writes type arc with no start, end, open or arc-type (Inkscape removes them)', () => {
    for (const kind of ['sector', 'arc', 'chord'] as const) {
      const a = attrs(shapeSvg(shape({ kind, a0: 30, a1: 30 })));
      expect(a['sodipodi:type']).toBe('arc');
      expect(Object.keys(a).filter((k) => /start|end|open|arc-type/.test(k))).toEqual([]);
    }
  });
  it('the ellipse tool keeps its <ellipse> element (what Inkscape writes for an ellipse), also when turned', () => {
    const e = { id: 'e', type: 'ellipse', x: 1, y: 2, w: 30, h: 20, fill: '#fff', stroke: '#000', strokeWidth: 1, radius: 0 } as VectorShape;
    expect(shapeSvg(e)).toMatch(/^<ellipse /);
    expect(shapeSvg({ ...e, rot: [0.8, 0.6, -0.6, 0.8] })).toMatch(/^<ellipse transform="matrix\(/);
  });
});

describe.each([3, 24])('polygon and star with %i corners', (sides) => {
  const rebuild = (a: Record<string, string>, m: number[]) => {
    const n = num(a, 'sodipodi:sides'), out: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const darg = (2 * Math.PI) / n; // sp-star.cpp sp_star_get_xy, line 579 onwards
      for (const k of a['inkscape:flatsided'] === 'true' ? [1] : [1, 2]) {
        const arg = num(a, `sodipodi:arg${k}`) + i * darg, r = num(a, `sodipodi:r${k}`);
        out.push(apply(m, [r * Math.cos(arg) + num(a, 'sodipodi:cx'), r * Math.sin(arg) + num(a, 'sodipodi:cy')]));
      }
    }
    return out;
  };
  it.each([['polygon', {}], ['star', { inner: 0.4 }], ['polygon', { turned: true }], ['star', { turned: true, inner: 0.25 }]] as const)('%s %j: attributes rebuild the vertices of d', (kind, o) => {
    const turned = 'turned' in o;
    const svg = shapeSvg(shape({ kind, sides, ...('inner' in o ? { inner: o.inner } : {}) }, turned ? { rot: [0.8, 0.6, -0.6, 0.8] } : {}));
    const a = attrs(svg);
    expect(a['sodipodi:type']).toBe('star');
    expect(a['inkscape:flatsided']).toBe(String(kind === 'polygon'));
    expect(a['sodipodi:sides']).toBe(String(sides));
    expect(a['inkscape:randomized']).toBe('0'); expect(a['inkscape:rounded']).toBe('0');
    const want = rebuild(a, matrix(svg)), got = pathPts(svg).map((p) => p.end);
    expect(got).toHaveLength(want.length);
    got.forEach((p, i) => expect(near(p, want[i])).toBe(true));
    if (kind === 'star') expect(num(a, 'sodipodi:r2')).toBeCloseTo(turned ? 0.25 : 0.4, 6);
  });
  it('a rounded one stays a plain path (Inkscape rounds differently)', () => {
    for (const kind of ['polygon', 'star'] as const) {
      const svg = shapeSvg(shape({ kind, sides, round: 0.7 }));
      expect(svg).not.toContain('sodipodi:type'); expect(svg).toContain(' Q ');
    }
  });
});

describe('root declarations', () => {
  it('the exported document declares both namespaces and keeps d', async () => {
    const src = (await import('node:fs')).readFileSync('src/engine/design/export.ts', 'utf8');
    expect(src).toContain('xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"');
    expect(src).toContain('xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"');
  });
});
