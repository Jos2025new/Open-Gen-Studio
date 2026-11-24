import { NODE_WIDTH } from './flow/graph-layout';
import type { DesignDoc, Graph, GraphNode, Layer } from './types';

/* One position per element, kept in the entry's internal graph: Nodes shows it as is, Designer scaled to the page.
   (0, 0) means never placed. Pure. */
export interface BoardBox { x: number; y: number; width: number; height: number; fontSize: number }
type Ratio = (assetId: string) => number;

const PAGE = 1920, MAX_PAGE = 4096, MARGIN = 80, GAP = 60, MAX_SCALE = 3;

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
  const zero = rects.filter((r) => !r.x && !r.y), free = zero.length === rects.length || zero.length > 1 ? zero : [];
  if (!free.length) return rects;
  const kept = rects.filter((r) => !free.includes(r));
  const left = kept.length ? Math.min(...kept.map((r) => r.x)) : 0, top = kept.length ? Math.max(...kept.map((r) => r.y + r.h)) + GAP : 0;
  const cols = new Array<number>(Math.ceil(Math.sqrt(free.length))).fill(top);
  for (const r of free) {
    const c = cols.indexOf(Math.min(...cols));
    r.x = left + c * (NODE_WIDTH + GAP); r.y = cols[c]; cols[c] += r.h + GAP;
  }
  return rects;
}

export function boardLayout(nodes: readonly GraphNode[], ratio: Ratio): { width: number; height: number; boxes: Map<string, BoardBox> } {
  const placed = placeNodes(nodes, ratio), left = Math.min(...placed.map((r) => r.x)), top = Math.min(...placed.map((r) => r.y));
  const w = Math.max(...placed.map((r) => r.x + r.w)) - left, h = Math.max(...placed.map((r) => r.y + r.h)) - top;
  const k = Math.min(MAX_SCALE, (PAGE - 2 * MARGIN) / w, (MAX_PAGE - 2 * MARGIN) / h);
  const boxes = new Map(placed.map((r) => [r.id, { x: MARGIN + (r.x - left) * k, y: MARGIN + (r.y - top) * k, width: r.w * k, height: r.h * k, fontSize: Math.max(6, Math.round(r.fontSize * k)) }]));
  return { width: Math.round(w * k) + 2 * MARGIN, height: Math.round(h * k) + 2 * MARGIN, boxes };
}

/** The layer that shows a node: same image, or same text. */
export function layerOf(doc: DesignDoc, n: GraphNode): Layer | undefined {
  const d = n.data;
  if (d.kind === 'asset') return d.assetId ? doc.layers.find((l) => l.type === 'raster' && l.sourceAssetId === d.assetId) : undefined;
  return d.kind === 'text' ? doc.layers.find((l) => l.type === 'text' && l.text === d.text) : undefined;
}

/** Page pixels per graph unit (middle image width) and where graph (0, 0) falls on the page. */
export function boardFrame(doc: DesignDoc, graph: Graph | undefined): { k: number; x: number; y: number } | null {
  const pairs = (graph?.nodes ?? []).flatMap((n) => { const l = layerOf(doc, n); return l && 'x' in l ? [{ n, l: l as Layer & { x: number; y: number; width: number } }] : []; });
  const widths = pairs.filter((p) => p.l.type === 'raster').map((p) => p.l.width).sort((a, b) => a - b);
  const k = widths.length ? widths[widths.length >> 1] / NODE_WIDTH : 0, at = pairs.find((p) => p.n.position.x || p.n.position.y);
  return k > 0 ? { k, x: at ? at.l.x - at.n.position.x * k : 0, y: at ? at.l.y - at.n.position.y * k : 0 } : null;
}

/** Saving a document writes its layers' positions back into the graph; images it has and the graph lacks join it. */
export function graphFromDoc(graph: Graph | undefined, doc: DesignDoc, isImage: (assetId: string) => boolean, newId: () => string): Graph | undefined {
  const base = graph ?? { nodes: [], edges: [] }, known = new Set(base.nodes.map((n) => (n.data.kind === 'asset' ? n.data.assetId : undefined)));
  const extra = [...new Map(doc.layers.flatMap((l) => (l.type === 'raster' && l.sourceAssetId && isImage(l.sourceAssetId) && !known.has(l.sourceAssetId) ? [[l.sourceAssetId, l.name] as const] : [])))]
    .map(([assetId, title]): GraphNode => ({ id: newId(), position: { x: 0, y: 0 }, data: { kind: 'asset', title, assetId } }));
  const next: Graph = { ...base, nodes: [...base.nodes, ...extra] }, frame = boardFrame(doc, next);
  if (!frame) return graph;
  const at = (v: number, o: number) => Math.round((v - o) / frame.k);
  return { ...next, nodes: next.nodes.map((n) => { const l = layerOf(doc, n); return l && 'x' in l ? { ...n, position: { x: at(l.x, frame.x), y: at(l.y, frame.y) } } : n; }) };
}

const keyOf = (n: GraphNode): string | null => (n.data.kind === 'asset' ? (n.data.assetId ? `a:${n.data.assetId}` : null) : n.data.kind === 'text' ? `t:${n.data.text}` : null);
const median = (v: number[]): number => (v.length ? [...v].sort((a, b) => a - b)[(v.length - 1) >> 1] : 0);

/** What changed in the graph since `base` (the one `doc` was made from): moved, rewritten and new elements. Moving the
    whole group is not a change, and an element the document no longer has is not brought back. */
export function graphChanges(doc: DesignDoc, base: Graph | undefined, cur: Graph | undefined, ratio: Ratio) {
  const at = (g?: Graph) => { const pos = new Map(placeNodes(g?.nodes ?? [], ratio).map((r) => [r.id, r])); return new Map((g?.nodes ?? []).flatMap((n) => { const key = keyOf(n); return key ? [[key, { n, x: pos.get(n.id)!.x, y: pos.get(n.id)!.y }] as const] : []; })); };
  const was = at(base), now = at(cur), same = [...now].flatMap(([key, v]) => (was.has(key) ? [{ ...v, dx: v.x - was.get(key)!.x, dy: v.y - was.get(key)!.y }] : []));
  const sx = median(same.map((s) => s.dx)), sy = median(same.map((s) => s.dy)), k = boardFrame(doc, base)?.k ?? 1;
  const moves = same.flatMap((s) => { const l = layerOf(doc, s.n), dx = (s.dx - sx) * k, dy = (s.dy - sy) * k; return l && 'x' in l && (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) ? [{ layerId: l.id, x: l.x + dx, y: l.y + dy }] : []; });
  const gone = [...was].filter(([key, v]) => !now.has(key) && v.n.data.kind === 'text').map(([, v]) => v.n);
  const texts: Array<{ layerId: string; text: string }> = [], adds: GraphNode[] = [];
  for (const [key, { n }] of now) {
    if (was.has(key) || layerOf(doc, n)) continue;
    const old = n.data.kind === 'text' ? gone.shift() : undefined, l = old && layerOf(doc, old);
    if (l && n.data.kind === 'text') texts.push({ layerId: l.id, text: n.data.text }); else if (!old) adds.push(n);
  }
  return { moves, texts, adds };
}
