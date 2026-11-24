import { NODE_WIDTH } from './flow/graph-layout';
import type { Graph, GraphNode } from './types';

/* One position per element, kept in the entry's internal graph: Nodes shows it as is, Designer scaled to the page.
   (0, 0) means never placed. Pure. */
type Ratio = (assetId: string) => number;

const PAGE = 1920, MAX_PAGE = 4096, MARGIN = 80, GAP = 60, MAX_SCALE = 3;

export const unplaced = (p: { x: number; y: number }): boolean => !p.x && !p.y;
/** A real position, never the (0, 0) that means none. */
export const placedAt = (x: number, y: number): { x: number; y: number } => {
  const p = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
  return unplaced(p) ? { x: 0.01, y: 0 } : { x: p.x || 0, y: p.y || 0 };
};

/** A graph given whole, drawn from the origin: with the rest placed, its one element at (0, 0) is placed there too. */
export function fromOrigin(graph: Graph): Graph {
  const zero = graph.nodes.filter((n) => unplaced(n.position));
  return zero.length === 1 && graph.nodes.length > 1 ? { ...graph, nodes: graph.nodes.map((n) => (n === zero[0] ? { ...n, position: placedAt(0, 0) } : n)) } : graph;
}

function natural(n: GraphNode, ratio: Ratio): { w: number; h: number; fontSize: number } {
  if (n.data.kind !== 'text') return { w: NODE_WIDTH, h: n.data.kind === 'asset' && n.data.assetId ? NODE_WIDTH / ratio(n.data.assetId) : NODE_WIDTH, fontSize: 0 };
  const lines = n.data.text.split('\n'), tall = (fs: number) => lines.reduce((sum, l) => sum + Math.max(1, Math.ceil((l.length * fs * 0.6) / NODE_WIDTH)), 0) * fs * 1.3;
  let fontSize = 18;
  while (fontSize > 6 && tall(fontSize) > NODE_WIDTH * 1.5) fontSize--;
  return { w: NODE_WIDTH, h: Math.max(NODE_WIDTH / 2, tall(fontSize)), fontSize };
}

/** Saved positions stay as they are (overlaps included); elements never placed go in even columns under them. */
export function placeNodes(nodes: readonly GraphNode[], ratio: Ratio): Array<{ id: string; x: number; y: number; w: number; h: number; fontSize: number }> {
  const rects = nodes.map((n) => ({ id: n.id, ...n.position, ...natural(n, ratio) }));
  const free = rects.filter(unplaced);
  const kept = rects.filter((r) => !free.includes(r));
  const left = kept.length ? Math.min(...kept.map((r) => r.x)) : 0, top = kept.length ? Math.max(...kept.map((r) => r.y + r.h)) + GAP : 0;
  const cols = new Array<number>(Math.ceil(Math.sqrt(free.length))).fill(top);
  for (const r of free) {
    const c = cols.indexOf(Math.min(...cols));
    r.x = left + c * (NODE_WIDTH + GAP); r.y = cols[c]; cols[c] += r.h + GAP;
  }
  return rects;
}

/** The page and the scale for these elements; with `page`, the scale that fits them on that page. */
export function boardLayout(nodes: readonly GraphNode[], ratio: Ratio, page?: { width: number; height: number }): { width: number; height: number; k: number; x: number; y: number } {
  const placed = placeNodes(nodes, ratio), left = Math.min(...placed.map((r) => r.x)), top = Math.min(...placed.map((r) => r.y));
  const w = Math.max(...placed.map((r) => r.x + r.w)) - left, h = Math.max(...placed.map((r) => r.y + r.h)) - top;
  const m = page ? Math.min(MARGIN, page.width * 0.08, page.height * 0.08) : MARGIN;
  const k = Math.min(MAX_SCALE, ((page?.width ?? PAGE) - 2 * m) / w, ((page?.height ?? MAX_PAGE) - 2 * m) / h);
  return { width: Math.round(w * k) + 2 * m, height: Math.round(h * k) + 2 * m, k, x: m - left * k, y: m - top * k };
}
