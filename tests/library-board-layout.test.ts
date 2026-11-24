import { describe, expect, it } from 'vitest';
import { boardLayout, graphChanges, graphFromDoc, placeNodes } from '../src/engine/libraryLayout';
import type { DesignDoc, Graph, GraphNode } from '../src/engine/types';

const img = (id: string, x = 0, y = 0): GraphNode => ({ id, position: { x, y }, data: { kind: 'asset', title: id, assetId: `as_${id}` } });
const txt = (id: string, text: string, x = 0, y = 0): GraphNode => ({ id, position: { x, y }, data: { kind: 'text', title: id, text } as GraphNode['data'] });
const graph = (...nodes: GraphNode[]): Graph => ({ nodes, edges: [] });
const ratio = () => 1;
/** The document a graph opens as. */
const docOf = (g: Graph): DesignDoc => {
  const { width, height, boxes } = boardLayout(g.nodes, ratio);
  const layers = g.nodes.map((n) => { const b = boxes.get(n.id)!; return { id: `l_${n.id}`, name: n.id, ...b, ...(n.data.kind === 'text' ? { type: 'text', text: n.data.text } : { type: 'raster', sourceAssetId: (n.data as { assetId: string }).assetId }) }; });
  return { id: 'd', width, height, layers } as unknown as DesignDoc;
};
const overlap = (r: Array<{ x: number; y: number; w: number; h: number }>) => r.some((p, i) => r.slice(i + 1).some((q) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h));

describe('one position per element, in the graph', () => {
  it('keeps saved positions, overlaps included, and never-placed elements go under them without piling', () => {
    const r = placeNodes([img('a', 500, 300), img('b', 600, 350), img('c'), img('d'), img('e')], ratio);
    expect(r.slice(0, 2).map((p) => [p.x, p.y])).toEqual([[500, 300], [600, 350]]);
    expect(Math.min(...r.slice(2).map((p) => p.y))).toBeGreaterThanOrEqual(350 + 260);
    expect(overlap(r.slice(2))).toBe(false);
  });

  it('places any number of elements at 0,0 on a bounded page', () => {
    for (const n of [2, 3, 7, 40, 200]) {
      const nodes = Array.from({ length: n }, (_, i) => img(`i${i}`)), rs = (id: string) => [1, 16 / 9, 0.6, 6, 0.1][Number(id.slice(4)) % 5];
      expect(overlap(placeNodes(nodes, rs))).toBe(false);
      const { width, height } = boardLayout(nodes, rs);
      expect(width <= 1921 && height <= 4097).toBe(true);
    }
  });

  it('opening and saving without moving anything keeps the same coordinates', () => {
    const g = graph(img('a', 1000, 500), img('b', 1400, 560), txt('t', 'Oak', 1000, 900));
    const back = graphFromDoc(g, docOf(g), () => true, () => 'x')!;
    back.nodes.forEach((n, i) => { expect(Math.abs(n.position.x - g.nodes[i].position.x)).toBeLessThanOrEqual(1); expect(Math.abs(n.position.y - g.nodes[i].position.y)).toBeLessThanOrEqual(1); });
  });

  it('moving a layer in Designer moves its node, and new images join the graph', () => {
    const g = graph(img('a', 100, 100), img('b', 500, 100)), doc = docOf(g), k = (doc.layers[0] as { width: number }).width / 260;
    (doc.layers[1] as { x: number }).x += 100 * k;
    doc.layers.push({ ...doc.layers[0], id: 'l_new', name: 'New', sourceAssetId: 'as_new', y: (doc.layers[0] as { y: number }).y + 300 * k } as never, { ...doc.layers[0], id: 'l_gone', sourceAssetId: 'as_gone' } as never);
    const back = graphFromDoc(g, doc, (id) => id !== 'as_gone', () => 'nd_new')!;
    expect(back.nodes.map((n) => [n.id, n.position])).toEqual([['a', { x: 100, y: 100 }], ['b', { x: 600, y: 100 }], ['nd_new', { x: 100, y: 400 }]]);
  });

  it('a move, a rewrite and an addition in Nodes reach the document; moving the whole group or removing a layer changes nothing', () => {
    const g = graph(img('a', 100, 100), img('b', 500, 100), img('c', 900, 100), txt('t', 'Oak', 100, 500)), doc = docOf(g);
    const shifted = graph(...g.nodes.map((n, i) => ({ ...n, id: `new${i}`, position: { x: n.position.x + 3000, y: n.position.y - 700 } })));
    expect(graphChanges(doc, g, shifted, ratio)).toEqual({ moves: [], texts: [], adds: [] });
    const without = { ...doc, layers: doc.layers.filter((l) => l.id !== 'l_b') };
    expect(graphChanges(without, g, shifted, ratio).adds).toEqual([]);

    const edited = graph(shifted.nodes[0], { ...shifted.nodes[1], position: { x: shifted.nodes[1].position.x, y: shifted.nodes[1].position.y + 50 } }, shifted.nodes[2], txt('t2', 'Dark oak', 3100, -200), img('z', 3100, 300));
    const { moves, texts, adds } = graphChanges(doc, g, edited, ratio), b = doc.layers[1] as { x: number; y: number; width: number };
    expect(moves).toHaveLength(1);
    expect(moves[0].layerId).toBe('l_b');
    expect(moves[0].x).toBeCloseTo(b.x, 3);
    expect(moves[0].y - b.y).toBeCloseTo((50 * b.width) / 260, 3);
    expect(texts).toEqual([{ layerId: 'l_t', text: 'Dark oak' }]);
    expect(adds.map((n) => n.id)).toEqual(['z']);
  });
});
