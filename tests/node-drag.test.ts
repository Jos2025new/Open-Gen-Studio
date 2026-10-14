import { describe, expect, it } from 'vitest';
import { nodeHandles, nodeSegs, parseSegs, type Seg } from '../src/engine/design/pathNodes';
import { alignNode, focusNodes, nodePosition, pullHandle } from '../src/engine/design/nodeTypes';
import { bezierAt, dragSegment, dragWeight, nearestSegment } from '../src/engine/design/segmentDrag';
import { insertNode, nearestOnPath } from '../src/engine/design/pathNodeOps';

const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);
const angleBetween = (a: [number, number], at: [number, number], b: [number, number]) => {
  const u = [a[0] - at[0], a[1] - at[1]], v = [b[0] - at[0], b[1] - at[1]];
  const c = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v));
  return Math.acos(Math.max(-1, Math.min(1, c))) * (180 / Math.PI);
};
/** Points of an outline, sampled along every curve (for shape comparisons). */
const sample = (segs: Seg[], steps = 200): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  segs.forEach((s, i) => {
    if (i === 0 || s.c === 'Z') return;
    const p0 = segs[i - 1].p[segs[i - 1].p.length - 1], p3 = s.p[s.p.length - 1];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      out.push(s.c === 'L' ? [p0[0] + (p3[0] - p0[0]) * t, p0[1] + (p3[1] - p0[1]) * t] : bezierAt(p0, s.p[0], s.p[1], p3, t));
    }
  });
  return out;
};
const curve = () => parseSegs('M 0 0 C 0 60 100 60 100 0 C 100 -60 200 -60 200 0');

describe('two handles per node', () => {
  it('an inner node of a curved path has both handles; the ends of an open path have one', () => {
    const segs = curve();
    expect(nodeHandles(segs, 1)).toEqual({ in: [1, 1], out: [2, 0] });
    expect(nodeHandles(segs, 0)).toEqual({ out: [1, 0] });
    expect(nodeHandles(segs, 2)).toEqual({ in: [2, 1] });
  });

  it('the handles of the selected node and of its neighbours are the ones to show, ends clamped', () => {
    expect(focusNodes(curve(), [1])).toEqual([0, 1, 2]);
    expect(focusNodes(curve(), [0])).toEqual([0, 1]);
    expect(focusNodes(curve(), [2])).toEqual([1, 2]);
  });
});

describe('node types: converting rewrites the handles now', () => {
  it('smooth lines the two handles through the node and keeps each length', () => {
    const segs = parseSegs('M 0 0 C 10 0 30 0 40 0 C 50 30 60 30 70 0'); // corner at (40,0): in handle (30,0), out handle (50,30)
    const a = alignNode(segs, 1, 's');
    const h = nodeHandles(a, 1)!;
    const i = a[h.in![0]].p[h.in![1]], o = a[h.out![0]].p[h.out![1]];
    near(angleBetween(i, [40, 0], o), 180, 1e-4);
    near(Math.hypot(i[0] - 40, i[1] - 0), 10);
    near(Math.hypot(o[0] - 40, o[1] - 0), Math.hypot(50 - 40, 30));
  });

  it('symmetric also makes both handles the same length', () => {
    const a = alignNode(parseSegs('M 0 0 C 10 0 30 0 40 0 C 50 30 60 30 70 0'), 1, 'z');
    const h = nodeHandles(a, 1)!;
    const i = a[h.in![0]].p[h.in![1]], o = a[h.out![0]].p[h.out![1]];
    near(angleBetween(i, [40, 0], o), 180, 1e-4);
    near(Math.hypot(i[0] - 40, i[1]), Math.hypot(o[0] - 40, o[1]));
  });

  it('a handle with no length takes a third of the neighbouring segment when the node is converted, then lines up', () => {
    const a = alignNode(parseSegs('M 0 0 C 0 0 100 0 100 0 C 100 0 100 100 100 100'), 1, 's');
    const h = nodeHandles(a, 1)!;
    const i = a[h.in![0]].p[h.in![1]], o = a[h.out![0]].p[h.out![1]];
    // The out handle was zero-length: it took a third of the next segment (length 100/3), then the smooth rule
    // turned it in line with the in handle, keeping that length.
    near(Math.hypot(o[0] - 100, o[1]), 100 / 3, 1e-6);
    near(angleBetween(i, [100, 0], o), 180, 1e-4);
  });

  it('a corner node does not move its handles', () => {
    const segs = curve();
    expect(alignNode(segs, 1, 'c')).toEqual(segs);
  });
});

describe('segment drag: the curve passes through the grabbed point', () => {
  it('after the drag the point at t is the pointer, and the end nodes stay', () => {
    const segs = curve();
    const t = 0.3, grabbed = bezierAt([0, 0], [0, 60], [100, 60], [100, 0], t);
    const target: [number, number] = [grabbed[0] + 12, grabbed[1] - 20];
    const out = dragSegment(segs, 1, t, target);
    const p = bezierAt([0, 0], out[1].p[0], out[1].p[1], [100, 0], t);
    near(p[0], target[0]); near(p[1], target[1]);
    expect(out[1].p[2]).toEqual([100, 0]);
  });

  it('a straight segment becomes a curve when dragged', () => {
    const out = dragSegment(parseSegs('M 0 0 L 100 0'), 1, 0.5, [50, 25]);
    expect(out[1].c).toBe('C');
    const p = bezierAt([0, 0], out[1].p[0], out[1].p[1], [100, 0], 0.5);
    near(p[0], 50); near(p[1], 25);
  });

  it('the weight follows Inkscape: the front handle alone near the start, the back one alone near the end', () => {
    expect(dragWeight(0.1)).toBe(0);
    expect(dragWeight(0.9)).toBe(1);
    near(dragWeight(0.5), 0.5, 1e-9);
  });

  it('grabbing a segment finds it and its t; a click far from every segment finds nothing close', () => {
    const segs = curve();
    const q = bezierAt([0, 0], [0, 60], [100, 60], [100, 0], 0.25);
    const hit = nearestSegment(segs, q)!;
    expect(hit.i).toBe(1);
    expect(hit.t).toBeCloseTo(0.25, 1);
    expect(hit.dist).toBeLessThan(0.5);
  });
});

describe('insert on double-click keeps the shape', () => {
  it('the sampled outline is the same before and after inserting a node on a curve', () => {
    const segs = curve();
    const hit = nearestOnPath(segs, bezierAt([0, 0], [0, 60], [100, 60], [100, 0], 0.4));
    expect(hit).not.toBeNull();
    const types = Array.from({ length: nodeSegs(segs).seg.length }, () => 'c' as const);
    const r = insertNode(segs, types, hit!);
    const before = sample(segs, 60), after = sample(r.segs, 400);
    // Every sampled point of the old outline lies on the new one.
    for (const p of before) {
      const d = Math.min(...after.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1])));
      expect(d).toBeLessThan(0.2);
    }
  });
});

describe('Shift-drag pulls a handle out of a node', () => {
  it('a straight segment gets handles at its thirds and the pulled one moves', () => {
    const segs = parseSegs('M 0 0 L 90 0 L 90 90');
    const out = pullHandle(segs, 1, 'out', 0, 30);
    expect(out[2].c).toBe('C');
    expect(out[2].p[0][0]).toBeCloseTo(90, 6);
    expect(out[2].p[0][1]).toBeCloseTo(30, 6); // from the node (90,0), moved by the pointer
    expect(nodePosition(out, 1)).toEqual([90, 0]);
  });

  it('a node at the end of an open path has no handle beyond it', () => {
    const segs = parseSegs('M 0 0 C 0 60 100 60 100 0');
    const out = pullHandle(segs, 1, 'out', 5, 5);
    expect(out).toEqual(segs);
  });
});
