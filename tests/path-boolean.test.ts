import { describe, expect, it } from 'vitest';
import { booleanOp, eraseArea, eraseBand, faces, flatten, knifeArea, knifeStrip, mergeFaces, splitComponents } from '../src/engine/design/pathBoolean';
import { parseSegs, type Pt, type Seg } from '../src/engine/design/pathNodes';
import { shapeToPath } from '../src/engine/design/affine';
import type { ShapeSpec } from '../src/engine/types';

const rect = (x: number, y: number, w: number, h: number): Seg[] => parseSegs(`M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`);
function circle(cx: number, cy: number, r: number): Seg[] {
  const s = shapeToPath({ type: 'ellipse', x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, fill: '#000', stroke: null, strokeWidth: 0, radius: 0 } as ShapeSpec);
  return parseSegs((s as { d: string }).d);
}
const shoelace = (pts: Pt[]) => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + (p[0] * q[1] - q[0] * p[1]) / 2; }, 0);
/** Filled area by the rule: sum of signed loops (nonzero, holes oriented opposite) or outer minus holes by nesting (even-odd == abs sum with sign). */
const loops = (segs: Seg[]) => flatten(segs, 0.05).map((l) => shoelace(l.points));
const filled = (segs: Seg[]) => loops(segs).reduce((a, b) => a + b, 0);
const count = (segs: Seg[], c: string) => segs.filter((s) => s.c === c).length;
const near = (a: number, b: number, rel = 0.01) => expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.abs(b) * rel + 0.5);

describe('booleanOp', () => {
  const a = rect(0, 0, 100, 100), b = rect(50, 50, 100, 100);
  it('union / intersection / xor / difference areas', () => {
    near(Math.abs(filled(booleanOp('union', [{ segs: a }], [{ segs: b }]))), 17500);
    near(Math.abs(filled(booleanOp('intersection', [{ segs: a }], [{ segs: b }]))), 2500);
    near(Math.abs(filled(booleanOp('xor', [{ segs: a }], [{ segs: b }]))), 15000);
    near(Math.abs(filled(booleanOp('difference', [{ segs: a }], [{ segs: b }]))), 7500);
  });
  it('difference making a hole keeps opposite orientation (nonzero and evenodd both right)', () => {
    const r = booleanOp('difference', [{ segs: rect(0, 0, 100, 100) }], [{ segs: rect(30, 30, 40, 40) }]);
    const l = loops(r);
    expect(l).toHaveLength(2);
    expect(Math.sign(l[0])).not.toBe(Math.sign(l[1]));
    near(Math.abs(l[0]) - Math.abs(l[1]), 8400);
    near(Math.abs(filled(r)), 8400); // nonzero: signed sum
    expect(splitComponents(r)).toHaveLength(1);
  });
  it('honours the subject fill rule', () => {
    const star = [...rect(0, 0, 100, 100), ...rect(25, 25, 50, 50)]; // same direction: nonzero fills, evenodd makes a hole
    near(Math.abs(filled(booleanOp('union', [{ segs: star, fillRule: 'nonzero' }], []))), 10000);
    near(Math.abs(filled(booleanOp('union', [{ segs: star, fillRule: 'evenodd' }], []))) , 7500, 0.02);
  });
  it('refit keeps circles to few curves', () => {
    const r = booleanOp('union', [{ segs: circle(50, 50, 40) }], []);
    expect(count(r, 'C')).toBeLessThanOrEqual(8);
    near(Math.abs(filled(r)), Math.PI * 1600, 0.01);
  });
  it('degenerate input never throws', () => {
    expect(booleanOp('union', [], [])).toEqual([]);
    expect(booleanOp('difference', [{ segs: [] }], [{ segs: a }])).toEqual([]);
    expect(booleanOp('union', [{ segs: [{ c: 'M', p: [[NaN, 1]] }, { c: 'L', p: [[2, 3]] }] }], [])).toEqual([]);
    near(Math.abs(filled(booleanOp('difference', [{ segs: a }], []))), 10000);
  });
});

describe('erase and knife', () => {
  const disc = { segs: circle(100, 100, 60) };
  it('eraseBand: point is a circle, trail is a band', () => {
    near(Math.abs(filled(eraseBand([[10, 10]], 5))), Math.PI * 25, 0.03);
    near(Math.abs(filled(eraseBand([[0, 0], [100, 0]], 5))), 1000 + Math.PI * 25, 0.03);
    expect(eraseBand([], 5)).toEqual([]);
  });
  it('a band through the middle gives 2 closed components', () => {
    const parts = eraseArea(disc, [[20, 100], [180, 100]], 6);
    expect(parts).toHaveLength(2);
    for (const p of parts) { expect(count(p, 'Z')).toBe(1); expect(count(p, 'M')).toBe(1); }
  });
  it('rubbing only inside makes a hole', () => {
    const parts = eraseArea(disc, [[80, 100], [120, 100]], 6);
    expect(parts).toHaveLength(1);
    expect(count(parts[0], 'M')).toBe(2);
    expect(splitComponents(parts[0])).toHaveLength(1);
  });
  it('nothing touched returns the same reference; all erased returns []', () => {
    expect(eraseArea(disc, [[300, 300], [320, 300]], 5)[0]).toBe(disc.segs);
    expect(eraseArea(disc, [[100, 100]], 100)).toEqual([]);
  });
  it('knife: circle -> 2 pieces, each cut again -> 2 more; a miss returns the input', () => {
    const two = knifeArea(disc, [[0, 100], [200, 100]]);
    expect(two).toHaveLength(2);
    for (const p of two) expect(count(p, 'Z')).toBe(1);
    near(two.reduce((s, p) => s + Math.abs(filled(p)), 0), Math.PI * 3600, 0.01);
    for (const p of two) expect(knifeArea({ segs: p }, [[100, 0], [100, 200]])).toHaveLength(2);
    expect(knifeArea(disc, [[0, 0], [10, 0]])[0]).toBe(disc.segs);
    expect(knifeArea(disc, [[100, 100], [120, 100]])[0]).toBe(disc.segs); // notch, not a cut
    expect(knifeStrip([[0, 0], [10, 0]]).length).toBeGreaterThan(3);
    expect(knifeStrip([[0, 0]])).toEqual([]);
  });
  it('splitComponents separates pieces', () => {
    expect(splitComponents([...rect(0, 0, 10, 10), ...rect(50, 0, 10, 10)])).toHaveLength(2);
    expect(splitComponents([])).toEqual([]);
  });
});

describe('knife and eraser on shapes that already have several components', () => {
  const two = [...rect(0, 0, 100, 100), ...rect(300, 0, 50, 50)];
  const ser = (segs: Seg[]) => JSON.stringify(segs);
  it('a miss returns the input even when it has 2+ components', () => {
    expect(knifeArea({ segs: two }, [[200, -20], [200, 200]])[0]).toBe(two);
    expect(eraseArea({ segs: two }, [[200, 20], [220, 20]], 5)[0]).toBe(two);
    expect(knifeArea({ segs: two }, [[200, -20], [200, 200]])).toHaveLength(1);
    // a band near but not over a component
    expect(eraseArea({ segs: two }, [[200, 20], [210, 20]], 5)).toHaveLength(1);
    // a notch from the edge of one of them is not a cut
    expect(knifeArea({ segs: two }, [[90, 50], [150, 50]])[0]).toBe(two);
  });
  it('cutting 10 times far from an island leaves its segs byte-identical (no drift, no minArea drop)', () => {
    const island = circle(500, 500, 0.3); // tinier than minArea: untouched, so kept
    const big = circle(500, 700, 30);
    let pieces: Seg[][] = [[...rect(0, 0, 100, 100), ...island, ...big]];
    for (let i = 0; i < 10; i++) {
      const next = knifeArea({ segs: pieces.flat() }, [[5 + i * 8, -10], [5 + i * 8 + 3, 110]]);
      expect(next.length).toBeGreaterThan(pieces.length);
      pieces = next;
    }
    const all = pieces.map(ser);
    expect(all).toContain(ser(island));
    expect(all).toContain(ser(big));
    const erased = eraseArea({ segs: pieces.flat() }, [[0, 50], [100, 50]], 4);
    expect(erased.map(ser)).toContain(ser(island));
    expect(erased.map(ser)).toContain(ser(big));
    expect(splitComponents(pieces.flat()).map(ser)).toContain(ser(big));
  });
  it('knife pieces touch exactly (no hairline) while the outer outline stays put', () => {
    const [a, b] = knifeArea({ segs: rect(0, 0, 100, 100) }, [[50, -10], [50, 110]]);
    const xs = (segs: Seg[]) => flatten(segs, 0.05).flatMap((l) => l.points.map((p) => p[0]));
    const [aMax, bMin] = xs(a)[0] < 50 || Math.max(...xs(a)) <= 50.02 ? [Math.max(...xs(a)), Math.min(...xs(b))] : [Math.max(...xs(b)), Math.min(...xs(a))];
    expect(Math.abs(bMin - aMax)).toBeLessThan(0.01);
    expect(Math.abs(aMax - 50)).toBeLessThan(0.01);
    const all = [...xs(a), ...xs(b)];
    expect(Math.min(...all)).toBeCloseTo(0, 2);
    expect(Math.max(...all)).toBeCloseTo(100, 2);
  });
});

describe('faces', () => {
  it('two overlapping circles -> 3 faces with sources', () => {
    const f = faces([{ segs: circle(0, 0, 50) }, { segs: circle(60, 0, 50) }])!;
    expect(f).toHaveLength(3);
    expect(f.map((x) => x.sources.join(',')).sort()).toEqual(['0', '0,1', '1']);
    for (const x of f) expect(count(x.segs, 'C')).toBeLessThanOrEqual(8);
  });
  it('a cutter divides a face; mergeFaces joins adjacent faces without a seam', () => {
    const f = faces([{ segs: circle(0, 0, 50) }, { segs: circle(60, 0, 50) }])!;
    const only0 = f.find((x) => x.sources.join() === '0')!, both = f.find((x) => x.sources.length === 2)!;
    const m = mergeFaces([only0.segs, both.segs]);
    expect(count(m, 'M')).toBe(1);
    near(Math.abs(filled(m)), Math.PI * 2500, 0.01);
    const cut = faces([{ segs: rect(0, 0, 100, 100) }], [[[50, -10], [50, 110]]])!;
    expect(cut).toHaveLength(2);
    const whole = mergeFaces(cut.map((x) => x.segs));
    expect(count(whole, 'M')).toBe(1);
    near(Math.abs(filled(whole)), 10000, 0.005);
  });
  it('budget and degenerate', () => {
    expect(faces(Array.from({ length: 65 }, () => ({ segs: rect(0, 0, 1, 1) })))).toBeNull();
    expect(faces([])).toEqual([]);
    expect(mergeFaces([])).toEqual([]);
  });
});

describe('performance', () => {
  it('eraseArea on ~500 vertices with a 50 point trail is fast', () => {
    const pts: Pt[] = Array.from({ length: 500 }, (_, i): Pt => [300 + 200 * Math.cos((i / 500) * 6.2832) * (1 + 0.02 * Math.sin(i)), 300 + 200 * Math.sin((i / 500) * 6.2832)]);
    const area = { segs: parseSegs(`M ${pts[0]} ${pts.slice(1).map((p) => `L ${p}`).join(' ')} Z`) };
    const trail: Pt[] = Array.from({ length: 50 }, (_, i): Pt => [150 + i * 6, 300 + 40 * Math.sin(i / 5)]);
    eraseArea(area, trail, 12);
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) eraseArea(area, trail, 12);
    const ms = (performance.now() - t0) / 5;
    console.log(`eraseArea avg ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(40);
  });
});

describe('components by containment', () => {
  it('an island inside a hole is its own piece and keeps its segs; touching halves stay two pieces', () => {
    const ring = [...rect(0, 0, 100, 100), ...parseSegs('M 20 20 L 20 80 L 80 80 L 80 20 Z')];
    const isle = parseSegs('M 40 40 L 60 40 L 60 60 L 40 60 Z');
    const all = splitComponents([...ring, ...isle], 'nonzero');
    expect(all).toHaveLength(2);
    expect(JSON.stringify(all[1])).toBe(JSON.stringify(isle));
    expect(splitComponents([...rect(0, 0, 50, 100), ...rect(50, 0, 50, 100)])).toHaveLength(2);
  });
});

it('a knife cut leaves one node at each end of the cut, not a cluster of near-duplicates', async () => {
  const { knifeArea } = await import('../src/engine/design/pathBoolean');
  const k = 0.5523 * 100;
  const segs = [{ c: 'M', p: [[300, 200]] }, { c: 'C', p: [[300, 200 + k], [200 + k, 300], [200, 300]] }, { c: 'C', p: [[200 - k, 300], [100, 200 + k], [100, 200]] }, { c: 'C', p: [[100, 200 - k], [200 - k, 100], [200, 100]] }, { c: 'C', p: [[200 + k, 100], [300, 200 - k], [300, 200]] }, { c: 'Z', p: [] }] as never;
  for (const piece of knifeArea({ segs }, [[120, 60], [280, 340]])) {
    const ends = piece.filter((s) => s.p.length).map((s) => s.p[s.p.length - 1]);
    for (let i = 1; i < ends.length; i++) {
      const d = Math.hypot(ends[i][0] - ends[i - 1][0], ends[i][1] - ends[i - 1][1]);
      if (d > 1e-9) expect(d).toBeGreaterThan(0.5);
    }
  }
});

it('a knife gap leaves that much space between the pieces; 0 keeps them touching', async () => {
  const { knifeArea, flatten } = await import('../src/engine/design/pathBoolean');
  const sq = [{ c: 'M', p: [[0, 0]] }, { c: 'L', p: [[100, 0]] }, { c: 'L', p: [[100, 100]] }, { c: 'L', p: [[0, 100]] }, { c: 'Z', p: [] }] as never;
  const xs = (segs: never) => flatten(segs, 0.05).flatMap((l) => l.points.map((p) => p[0]));
  const spread = (gap: number) => {
    const [a, b] = knifeArea({ segs: sq }, [[50, -10], [50, 110]], { gap }).map((p) => xs(p as never));
    const [l, r] = Math.min(...a) < Math.min(...b) ? [a, b] : [b, a];
    return Math.min(...r) - Math.max(...l);
  };
  expect(spread(0)).toBeLessThan(0.01);
  expect(spread(4)).toBeCloseTo(4, 1);
});
