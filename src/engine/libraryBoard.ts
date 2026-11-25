import { uid } from '../lib/id';
import { setDoc, toast, useStore } from '../store/store';
import { addTextLayer, assetCanvas, getDoc, mutateDoc, patchLayer, placeAssetCanvas, replaceLayerPixels } from './design/actions';
import { resizeCanvas } from './design/canvasSize';
import * as D from './design/doc';
import { openHistoryGroup } from './design/history';
import { ensureBuffers, getRasterSurface, isUnreadable, paintingLive } from './design/raster';
import { layerBox } from './design/render';
import { NODE_WIDTH } from './flow/graph-layout';
import { boardLayout, placedAt, placeNodes, unplaced } from './libraryLayout';
import type { KitBoard } from './libraryTypes';
import type { DesignDoc, Graph, GraphNode, Layer, RasterLayer } from './types';

/* An entry's graph elements as layers of a Designer document, at the positions the graph keeps. `doc.board` says which
   layer is which element and what both sides last agreed on, so a difference tells who changed it. */
const get = useStore.getState;
export const assetRatio = (assetId: string): number => { const a = get().assets[assetId]; return a && a.width > 0 && a.height > 0 ? a.width / a.height : 1; };
const isImageAsset = (assetId?: string | null): boolean => Boolean(assetId && get().assets[assetId]?.kind === 'image');
export const boardNodes = (graph?: Graph): GraphNode[] => {
  const nodes = graph?.nodes ?? [];
  return [...nodes.filter((n) => n.data.kind === 'asset' && isImageAsset(n.data.assetId)), ...nodes.filter((n) => n.data.kind === 'text' && n.data.text.trim())];
};

/** Where a layer shows: its top-left corner on the page. */
const cornerOf = (l: Layer): { x: number; y: number } | null => (l.type !== 'raster' && l.type !== 'text' ? null : l.transform ? layerBox(l) : l);
function linked(doc: DesignDoc, id: string) {
  const at = doc.board?.at[id], layer = at && doc.layers.find((l) => l.id === at.layer), p = layer && cornerOf(layer);
  if (!at || !layer || !p) return null;
  const b = doc.board!, home = { x: b.x + at.x * b.k, y: b.y + at.y * b.k };
  return { at, layer, p, movedHere: Math.abs(p.x - home.x) > 0.5 || Math.abs(p.y - home.y) > 0.5 };
}

/** Layers the document still shows: its own and the ones merged into them. */
const shownIds = (doc: DesignDoc) => new Set(doc.layers.flatMap((l) => (l.type === 'raster' ? [l.id, ...(l.merged ?? [])] : [l.id])));

/** The document without the elements the graph no longer has. A merged layer stays; only its link goes. */
export function withoutGone(doc: DesignDoc, graph: Graph | undefined): DesignDoc {
  const ids = new Set(graph?.nodes.map((n) => n.id)), gone = Object.entries(doc.board?.at ?? {}).filter(([id]) => !ids.has(id));
  if (!gone.length) return doc;
  const next = gone.reduce((d, [, a]) => (d.layers.some((l) => l.id === a.layer) ? D.removeLayer(d, a.layer) : d), doc);
  return { ...next, board: { ...doc.board!, at: Object.fromEntries(Object.entries(doc.board!.at).filter(([id]) => ids.has(id))) } };
}

/** The graph with what this document changed, and the document's board for it. On a moodboard its other images and texts join. */
export function graphFromDoc(graph: Graph | undefined, doc: DesignDoc, joins: boolean): { graph?: Graph; board?: KitBoard } {
  const known = new Map(Object.entries(doc.board?.at ?? {}).map(([id, a]) => [a.layer, id])), shown = shownIds(doc);
  const gone = new Set([...known].flatMap(([layer, id]) => (shown.has(layer) ? [] : [id])));
  // Saving replaces the entry with what the document shows, so an element another space removed comes back with its layer.
  const ids = new Set(graph?.nodes.map((n) => n.id));
  const fresh = doc.layers.filter((l) => (known.has(l.id) ? !ids.has(known.get(l.id)!) : joins) && ((l.type === 'raster' && isImageAsset(l.sourceAssetId)) || (l.type === 'text' && l.text.trim())));
  const image = fresh.find((l) => l.type === 'raster') as { width: number } | undefined, k = (image?.width ?? doc.width / 3) / NODE_WIDTH;
  const board = doc.board ?? (fresh.length ? { k, x: -100 * k, y: -100 * k, at: {} } : undefined);
  if (!board) return { graph };
  const spot = (p: { x: number; y: number }) => placedAt((p.x - board.x) / board.k, (p.y - board.y) / board.k), at = { ...board.at };
  for (const id of gone) delete at[id];
  const nodes = (graph?.nodes ?? []).filter((n) => !gone.has(n.id)).map((n): GraphNode => {
    const e = linked(doc, n.id);
    if (!e) return n;
    const text = e.layer.type === 'text' && e.layer.text !== e.at.text && e.layer.text.trim() ? e.layer.text : undefined;
    const position = e.movedHere ? spot(e.p) : unplaced(n.position) ? { x: e.at.x, y: e.at.y } : n.position;
    if (position !== n.position || text !== undefined) at[n.id] = { ...e.at, ...(position !== n.position ? position : {}), ...(text !== undefined ? { text } : {}) };
    return { ...n, position, data: text !== undefined && n.data.kind === 'text' ? { ...n.data, text } : n.data };
  });
  for (const l of fresh) {
    const p = cornerOf(l), id = known.get(l.id) ?? uid('nd');
    if (!p) continue;
    const position = spot(p);
    nodes.push({ id, position, data: l.type === 'text' ? { kind: 'text', title: l.name, text: l.text } : { kind: 'asset', title: l.name, assetId: (l as { sourceAssetId: string }).sourceAssetId } });
    at[id] = { layer: l.id, ...position, ...(l.type === 'text' ? { text: l.text } : {}) };
  }
  const edges = (graph?.edges ?? []).filter((e) => !gone.has(e.source) && !gone.has(e.target));
  const groups = graph?.groups?.map((g) => ({ ...g, nodeIds: g.nodeIds.filter((id) => !gone.has(id)) }));
  for (const id of Object.keys(at)) if (!nodes.some((n) => n.id === id)) delete at[id];
  return { graph: { ...graph, nodes, edges, ...(groups ? { groups } : {}) }, board: { ...board, at } };
}

/** The document with what the graph changed: moves, texts and removals. What was moved or written here and not saved stays. */
function syncDoc(opened: DesignDoc, graph: Graph | undefined): DesignDoc {
  const doc = withoutGone(opened, graph), b = doc.board;
  if (!b) return doc;
  const layers = new Map(doc.layers.map((l) => [l.id, l])), at = { ...b.at };
  let changed = false;
  for (const n of graph?.nodes ?? []) {
    const e = linked(doc, n.id);
    if (!e) continue;
    const pos = unplaced(n.position) ? e.at : n.position, text = n.data.kind === 'text' ? n.data.text : e.at.text;
    let l: Layer = e.layer;
    if (!e.movedHere && (pos.x !== e.at.x || pos.y !== e.at.y)) l = D.translateLayer(l, b.x + pos.x * b.k - e.p.x, b.y + pos.y * b.k - e.p.y);
    if (l.type === 'text' && text !== undefined && l.text === e.at.text && text !== l.text) l = { ...l, text };
    if (l !== e.layer) layers.set(l.id, l);
    if (pos.x !== e.at.x || pos.y !== e.at.y || text !== e.at.text) { at[n.id] = { ...e.at, x: pos.x, y: pos.y, ...(text !== undefined ? { text } : {}) }; changed = true; }
  }
  return changed ? { ...doc, layers: doc.layers.map((l) => layers.get(l.id) ?? l), board: { ...b, at } } : doc;
}

function ownLayer(doc: DesignDoc, node: GraphNode, taken: ReadonlySet<string>, kind: string | undefined, born = !doc.board): Layer | undefined {
  if (!born && kind === 'moodboard') return;
  const data = node.data;
  return doc.layers.find(l => !taken.has(l.id) && (
    (l.type === 'raster' && data.kind === 'asset' && l.sourceAssetId === data.assetId)
    || (born && l.type === 'text' && data.kind === 'text' && l.text === data.text)
  ));
}

const canRefresh = (layer: RasterLayer) => layer.sourceAssetId && layer.rev === (layer.libraryImageRev ?? 0)
  && !layer.locked && !layer.paintBaseId && !layer.paintStrokes?.length && !layer.paintFlattened && !isUnreadable(layer.id);

interface BoardImages {
  items: GraphNode[];
  images: Map<string, HTMLCanvasElement>;
}

/** Resolve imports before opening the document's history group. Existing pixels must also be ready for undo. */
export async function loadBoardImages(doc: DesignDoc, graph: Graph | undefined, kind: string | undefined): Promise<BoardImages> {
  const items = boardNodes(graph), images: BoardImages['images'] = new Map();
  const taken = new Set(Object.values(doc.board?.at ?? {}).map(a => a.layer));
  for (const n of items) {
    if (n.data.kind !== 'asset' || !n.data.assetId) continue;
    const id = n.data.assetId, entry = linked(doc, n.id);
    if (doc.board?.at[n.id]) {
      if (entry?.layer.type !== 'raster' || entry.layer.sourceAssetId === id || !canRefresh(entry.layer)) continue;
      await ensureBuffers([entry.layer]);
    } else {
      const own = ownLayer(doc, n, taken, kind);
      if (own) { taken.add(own.id); continue; }
    }
    try { images.set(n.id, await assetCanvas(id)); } catch { /* Report missing images when applying the graph. */ }
  }
  return { items, images };
}

function missingImage(assetId: string, title: string | undefined) {
  toast(`Could not load image "${title?.trim() || get().assets[assetId]?.name || assetId}".`, 'error');
}

function placeNode(sessionId: string, docId: string, n: GraphNode, box: { x: number; y: number; width: number; height: number; fontSize: number }, images: BoardImages['images']): string | null {
  const d = n.data;
  if (d.kind === 'text') return addTextLayer(sessionId, docId, d.text, box, { fontSize: box.fontSize }, d.title || undefined);
  if (d.kind !== 'asset' || !d.assetId) return null;
  const canvas = isImageAsset(d.assetId) && images.get(n.id);
  if (!canvas) { missingImage(d.assetId, d.title); return null; }
  const id = placeAssetCanvas(sessionId, docId, d.assetId, canvas, 'new', d.title || undefined);
  images.delete(n.id);
  if (id) {
    const fit = D.fitRect(box.width, box.height, canvas.width, canvas.height, 'contain');
    patchLayer(sessionId, docId, id, { width: fit.width, height: fit.height, x: box.x, y: box.y }, { record: false });
  }
  return id;
}

/** Brings the graph to an open document in one synchronous undo step. */
export function bringGraph(sessionId: string, docId: string, graph: Graph | undefined, kind: string | undefined, prepared: BoardImages): void {
  const history = openHistoryGroup(docId, { join: true });
  try { updateBoard(sessionId, docId, graph, kind, prepared); } finally { history.close(); }
}

function updateBoard(sessionId: string, docId: string, graph: Graph | undefined, kind: string | undefined, { items, images }: BoardImages): void {
  const was = getDoc(sessionId, docId), synced = was && syncDoc(was, graph);
  if (was && synced && synced !== was) mutateDoc(sessionId, docId, () => synced, { record: synced.layers.length !== was.layers.length || synced.layers.some((l, i) => l !== was.layers[i]) });
  const doc = getDoc(sessionId, docId), news = items.filter((n) => !doc?.board?.at[n.id]);
  if (!doc) return;
  for (const n of items) {
    const d = n.data, e = linked(doc, n.id);
    if (d.kind !== 'asset' || !d.assetId || e?.layer.type !== 'raster' || e.layer.sourceAssetId === d.assetId) continue;
    if (!canRefresh(e.layer) || paintingLive() || !getRasterSurface(e.layer.id)) continue;
    const canvas = isImageAsset(d.assetId) && images.get(n.id);
    if (!canvas) { missingImage(d.assetId, d.title); continue; }
    replaceLayerPixels(sessionId, docId, e.layer.id, d.assetId, canvas);
    images.delete(n.id);
  }
  if (!news.length) return;
  const born = !doc.board;
  if (born) setDoc(sessionId, docId, (d) => { const { k, x, y } = boardLayout(items, assetRatio, d); return { ...d, board: { k, x, y, at: {} } }; });
  const rects = new Map(placeNodes(items, assetRatio).map((r) => [r.id, r]));
  let right = doc.width, bottom = doc.height;
  for (const n of news) {
    const live = getDoc(sessionId, docId), b = live?.board, r = rects.get(n.id)!;
    if (!live || !b) return;
    const taken = new Set(Object.values(b.at).map((a) => a.layer)), d = n.data;
    // Outside moodboards the document's own images are not elements, so one that joined the graph elsewhere is already here.
    const own = ownLayer(live, n, taken, kind, born);
    const box = { x: b.x + r.x * b.k, y: b.y + r.y * b.k, width: r.w * b.k, height: r.h * b.k, fontSize: Math.max(6, Math.round(r.fontSize * b.k)) };
    const layer = (own ? own.id : undefined) ?? placeNode(sessionId, docId, n, box, images);
    if (!layer) continue;
    if (!own) { right = Math.max(right, Math.ceil(box.x + box.width - 0.5)); bottom = Math.max(bottom, Math.ceil(box.y + box.height - 0.5)); }
    setDoc(sessionId, docId, (x) => (x.board ? { ...x, board: { ...x.board, at: { ...x.board.at, [n.id]: { layer, ...placedAt(r.x, r.y), ...(d.kind === 'text' ? { text: d.text } : {}) } } } } : x));
  }
  // The page grows right and down to show what was added; nothing already on it moves.
  const now = getDoc(sessionId, docId);
  const problem = now && resizeCanvas(sessionId, docId, Math.max(now.width, right), Math.max(now.height, bottom), 'top-left', { record: false });
  if (problem) toast(`Some elements are outside the page. ${problem}`, 'error');
}
