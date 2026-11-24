import { uid } from '../lib/id';
import { setDoc, toast, useStore } from '../store/store';
import { addTextLayer, getDoc, mutateDoc, patchLayer, placeAsset } from './design/actions';
import { resizeCanvas } from './design/canvasSize';
import * as D from './design/doc';
import { layerBox } from './design/render';
import { NODE_WIDTH } from './flow/graph-layout';
import { boardLayout, placedAt, placeNodes, unplaced } from './libraryLayout';
import type { KitBoard } from './libraryTypes';
import type { DesignDoc, Graph, GraphNode, Layer } from './types';

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

/** The graph with what this document changed, and the document's board for it. On a moodboard its other images and texts join. */
export function graphFromDoc(graph: Graph | undefined, doc: DesignDoc, joins: boolean): { graph?: Graph; board?: KitBoard } {
  const known = new Set(Object.values(doc.board?.at ?? {}).map((a) => a.layer));
  const fresh = joins ? doc.layers.filter((l) => !known.has(l.id) && ((l.type === 'raster' && isImageAsset(l.sourceAssetId)) || (l.type === 'text' && l.text.trim()))) : [];
  const image = fresh.find((l) => l.type === 'raster') as { width: number } | undefined, k = (image?.width ?? doc.width / 3) / NODE_WIDTH;
  const board = doc.board ?? (fresh.length ? { k, x: -100 * k, y: -100 * k, at: {} } : undefined);
  if (!board) return { graph };
  const spot = (p: { x: number; y: number }) => placedAt((p.x - board.x) / board.k, (p.y - board.y) / board.k), at = { ...board.at };
  const nodes = (graph?.nodes ?? []).map((n): GraphNode => {
    const e = linked(doc, n.id);
    if (!e) return n;
    const text = e.layer.type === 'text' && e.layer.text !== e.at.text && e.layer.text.trim() ? e.layer.text : undefined;
    const position = e.movedHere ? spot(e.p) : unplaced(n.position) ? { x: e.at.x, y: e.at.y } : n.position;
    return { ...n, position, data: text !== undefined && n.data.kind === 'text' ? { ...n.data, text } : n.data };
  });
  for (const l of fresh) {
    const p = cornerOf(l), id = uid('nd');
    if (!p) continue;
    const position = spot(p);
    nodes.push({ id, position, data: l.type === 'text' ? { kind: 'text', title: l.name, text: l.text } : { kind: 'asset', title: l.name, assetId: (l as { sourceAssetId: string }).sourceAssetId } });
    at[id] = { layer: l.id, ...position, ...(l.type === 'text' ? { text: l.text } : {}) };
  }
  return { graph: { edges: [], ...graph, nodes }, board: { ...board, at } };
}

/** The document with what the graph changed. What was changed here and not saved stays; nothing is removed or added. */
export function syncDoc(doc: DesignDoc, graph: Graph | undefined): DesignDoc {
  const b = doc.board;
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

/** Writes the synced document; one undo step when a layer changed. */
export function applySync(sessionId: string, docId: string, fn: (d: DesignDoc) => DesignDoc): void {
  const doc = getDoc(sessionId, docId), next = doc && fn(doc);
  if (!doc || !next || next === doc) return;
  mutateDoc(sessionId, docId, fn, { record: next.layers.some((l, i) => l !== doc.layers[i]) });
}

async function placeNode(sessionId: string, docId: string, n: GraphNode, box: { x: number; y: number; width: number; height: number; fontSize: number }): Promise<string | null> {
  const d = n.data;
  if (d.kind === 'text') return addTextLayer(sessionId, docId, d.text, box, { fontSize: box.fontSize }, d.title || undefined);
  if (d.kind !== 'asset' || !d.assetId) return null;
  try {
    const id = await placeAsset(sessionId, docId, d.assetId, 'new', d.title || undefined), layer = getDoc(sessionId, docId)?.layers.find((l) => l.id === id);
    if (layer?.type === 'raster') {
      const fit = D.fitRect(box.width, box.height, layer.pxWidth, layer.pxHeight, 'contain');
      patchLayer(sessionId, docId, layer.id, { width: fit.width, height: fit.height, x: box.x, y: box.y }, { record: false });
      return layer.id;
    }
  } catch {}
  toast(`Could not load image "${d.title?.trim() || get().assets[d.assetId]?.name || d.assetId}".`, 'error');
  return null;
}

/** Brings the graph to an open document: its changes first, then the elements the document never had. */
export async function bringGraph(sessionId: string, docId: string, graph: Graph | undefined): Promise<void> {
  applySync(sessionId, docId, (d) => syncDoc(d, graph));
  const doc = getDoc(sessionId, docId), items = boardNodes(graph), news = items.filter((n) => !doc?.board?.at[n.id]);
  if (!doc || !news.length) return;
  if (!doc.board) setDoc(sessionId, docId, (d) => { const { k, x, y } = boardLayout(items, assetRatio, d); return { ...d, board: { k, x, y, at: {} } }; });
  const rects = new Map(placeNodes(items, assetRatio).map((r) => [r.id, r]));
  let right = doc.width, bottom = doc.height;
  for (const n of news) {
    const live = getDoc(sessionId, docId), b = live?.board, r = rects.get(n.id)!;
    if (!live || !b) return;
    const taken = new Set(Object.values(b.at).map((a) => a.layer)), d = n.data;
    // Its image may already be here: an entry that was born from this document.
    const own = live.layers.find((l) => !taken.has(l.id) && ((l.type === 'raster' && d.kind === 'asset' && l.sourceAssetId === d.assetId) || (l.type === 'text' && d.kind === 'text' && l.text === d.text)));
    const box = { x: b.x + r.x * b.k, y: b.y + r.y * b.k, width: r.w * b.k, height: r.h * b.k, fontSize: Math.max(6, Math.round(r.fontSize * b.k)) };
    const layer = own?.id ?? await placeNode(sessionId, docId, n, box);
    if (!layer) continue;
    if (!own) { right = Math.max(right, Math.ceil(box.x + box.width - 0.5)); bottom = Math.max(bottom, Math.ceil(box.y + box.height - 0.5)); }
    setDoc(sessionId, docId, (x) => (x.board ? { ...x, board: { ...x.board, at: { ...x.board.at, [n.id]: { layer, ...placedAt(r.x, r.y), ...(d.kind === 'text' ? { text: d.text } : {}) } } } } : x));
  }
  // The page grows right and down to show what was added; nothing already on it moves.
  const now = getDoc(sessionId, docId);
  const problem = now && resizeCanvas(sessionId, docId, Math.max(now.width, right), Math.max(now.height, bottom), 'top-left');
  if (problem) toast(`Some elements are outside the page. ${problem}`, 'error');
}
