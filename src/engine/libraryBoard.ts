import { toast, useStore } from '../store/store';
import { addTextLayer, getDoc, patchLayer, placeAsset } from './design/actions';
import { resizeCanvas } from './design/canvasSize';
import * as D from './design/doc';
import { NODE_WIDTH } from './flow/graph-layout';
import { layerBox } from './design/render';
import { boardFrame, graphChanges, type BoardBox } from './libraryLayout';
import type { Graph, GraphNode } from './types';

/* Puts an entry's graph elements on a Designer document, at the positions the graph keeps. */
const get = useStore.getState;
export const assetRatio = (assetId: string): number => { const a = get().assets[assetId]; return a && a.width > 0 && a.height > 0 ? a.width / a.height : 1; };
export const isImageAsset = (assetId?: string | null): boolean => Boolean(assetId && get().assets[assetId]?.kind === 'image');

export async function placeNode(sessionId: string, docId: string, n: GraphNode, box?: BoardBox): Promise<void> {
  const doc = getDoc(sessionId, docId), d = n.data;
  if (d.kind === 'text') {
    const at = box ?? { x: Math.round((doc?.width ?? 1080) * 0.08), y: Math.round((doc?.height ?? 1080) * 0.08), width: Math.round((doc?.width ?? 1080) * 0.84) };
    if (d.text.trim()) addTextLayer(sessionId, docId, d.text, at, box?.fontSize ? { fontSize: box.fontSize } : {}, d.title || undefined);
  } else if (d.kind === 'asset' && d.assetId) {
    try {
      const layerId = await placeAsset(sessionId, docId, d.assetId, 'new', d.title || undefined);
      const layer = layerId && box ? getDoc(sessionId, docId)?.layers.find((l) => l.id === layerId) : undefined;
      if (layer && box && layer.type === 'raster') {
        const fit = D.fitRect(box.width, box.height, layer.pxWidth, layer.pxHeight, 'contain');
        patchLayer(sessionId, docId, layer.id, { ...fit, x: box.x + fit.x, y: box.y + fit.y }, { record: false });
      }
      if (layerId) return;
    } catch {}
    toast(`Could not load image "${d.title?.trim() || get().assets[d.assetId]?.name || d.assetId}".`, 'error');
  }
}

/** The page grows, never shrinks, until these layers are on it. */
function growToFit(sessionId: string, docId: string, ids: ReadonlySet<string>): void {
  const doc = getDoc(sessionId, docId);
  const boxes = (doc?.layers ?? []).filter((l) => ids.has(l.id)).map(layerBox).filter((b) => b !== null);
  if (!doc || !boxes.length) return;
  const left = Math.ceil(Math.max(0, ...boxes.map((b) => -b.x))), top = Math.ceil(Math.max(0, ...boxes.map((b) => -b.y)));
  const right = Math.ceil(Math.max(doc.width, ...boxes.map((b) => b.x + b.w))), bottom = Math.ceil(Math.max(doc.height, ...boxes.map((b) => b.y + b.h)));
  const problem = resizeCanvas(sessionId, docId, doc.width + left, doc.height + top, 'bottom-right') ?? resizeCanvas(sessionId, docId, right + left, bottom + top, 'top-left');
  if (problem) toast(`Some elements are outside the page. ${problem}`, 'error');
}

/** Brings to an open document what other spaces changed in the graph since the document's own version. */
export async function syncDocFromGraph(sessionId: string, docId: string, base: Graph | undefined, cur: Graph | undefined): Promise<void> {
  const doc = getDoc(sessionId, docId);
  if (!doc) return;
  const { moves, texts, adds } = graphChanges(doc, base, cur, assetRatio);
  moves.forEach((m, i) => patchLayer(sessionId, docId, m.layerId, { x: m.x, y: m.y }, { record: i === 0 }));
  texts.forEach((t, i) => patchLayer(sessionId, docId, t.layerId, { text: t.text }, { record: !moves.length && i === 0 }));
  const live = getDoc(sessionId, docId) ?? doc, before = new Set(live.layers.map((l) => l.id)), frame = boardFrame(live, cur);
  for (const [i, n] of adds.entries()) {
    if (n.data.kind === 'asset' && !isImageAsset(n.data.assetId)) continue;
    const placed = frame && (n.position.x || n.position.y), w = frame ? NODE_WIDTH * frame.k : live.width / 3;
    const h = n.data.kind === 'asset' && n.data.assetId ? w / assetRatio(n.data.assetId) : w / 2, step = 24 * (i % 8);
    const at = placed ? { x: frame.x + n.position.x * frame.k, y: frame.y + n.position.y * frame.k } : { x: (live.width - w) / 2 + step, y: Math.max(0, (live.height - h) / 2) + step };
    await placeNode(sessionId, docId, n, live.layers.length ? { ...at, width: w, height: h, fontSize: n.data.kind === 'text' ? Math.max(6, Math.round(18 * (w / NODE_WIDTH))) : 0 } : undefined);
  }
  const placed = (getDoc(sessionId, docId)?.layers ?? []).filter((l) => !before.has(l.id)).map((l) => l.id);
  growToFit(sessionId, docId, new Set([...moves.map((m) => m.layerId), ...placed]));
}
