import { describe, expect, it } from 'vitest';
import { boardLayout, fromOrigin, placedAt, placeNodes } from '../src/engine/libraryLayout';
import type { GraphNode } from '../src/engine/types';

const img = (id: string, x = 0, y = 0): GraphNode => ({ id, position: { x, y }, data: { kind: 'asset', title: id, assetId: `as_${id}` } });
const ratio = () => 1;
const overlap = (r: Array<{ x: number; y: number; w: number; h: number }>) => r.some((p, i) => r.slice(i + 1).some((q) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h));

describe('positions of an entry on a page', () => {
  it('keeps saved positions, overlaps included, and never-placed elements go under them, also when there is only one', () => {
    for (const free of [[img('c')], [img('c'), img('d'), img('e')]]) {
      const r = placeNodes([img('a', 500, 300), img('b', 600, 350), ...free], ratio);
      expect(r.slice(0, 2).map((p) => [p.x, p.y])).toEqual([[500, 300], [600, 350]]);
      expect(Math.min(...r.slice(2).map((p) => p.y))).toBeGreaterThanOrEqual(350 + 260);
      expect(overlap(r.slice(2))).toBe(false);
    }
  });

  it('a placed element is never saved as (0, 0)', () => {
    expect(placedAt(0.001, -0.001)).toEqual({ x: 0.01, y: 0 });
    expect(placedAt(100.256, -3)).toEqual({ x: 100.26, y: -3 });
  });

  it('a whole graph drawn from the origin keeps its first element there', () => {
    const g = { nodes: [img('a'), img('b', 300)], edges: [] };
    expect(fromOrigin(g).nodes.map((n) => n.position)).toEqual([{ x: 0.01, y: 0 }, { x: 300, y: 0 }]);
    const free = { nodes: [img('a')], edges: [] };
    expect(fromOrigin(free)).toBe(free);
  });

  it('places any number of elements on a bounded page', () => {
    for (const n of [2, 3, 7, 40, 200]) {
      const nodes = Array.from({ length: n }, (_, i) => img(`i${i}`)), rs = (id: string) => [1, 16 / 9, 0.6, 6, 0.1][Number(id.slice(4)) % 5];
      expect(overlap(placeNodes(nodes, rs))).toBe(false);
      const { width, height } = boardLayout(nodes, rs);
      expect(width <= 1921 && height <= 4097).toBe(true);
    }
  });
});
