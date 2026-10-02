import { canvasIndex } from '../canvas';
import type { Asset } from '../types';
import { patchSession, useStore } from '../../store/store';
import * as D from './doc';
import { addDoc, placeAsset } from './actions';

const get = () => useStore.getState();

/** Chat image results of the session not in any design yet (as a layer's source), oldest first. */
export function chatImagesNotInDesigner(sessionId: string, includePlaced = false): Asset[] {
  const st = get();
  const s = st.sessions[sessionId];
  if (!s) return [];
  const index = canvasIndex(s, st.generations);
  const placed = new Set(s.docs.flatMap((d) => d.layers.map((l) => ('sourceAssetId' in l ? l.sourceAssetId : undefined)).filter(Boolean)));
  return Object.values(st.assets)
    .filter((a) => a.sessionId === sessionId && a.kind === 'image' && a.origin === 'generated' && (includePlaced || !placed.has(a.id)) && index.asset(a) === 'chat')
    .sort((a, b) => a.createdAt - b.createdAt);
}

function nameOf(a: Asset): string {
  const g = a.generationId ? get().generations[a.generationId] : undefined;
  const words = g ? (g.op ? g.op.id.replace(/_/g, ' ') : g.prompt) : 'Image';
  return words.split(/[.,\n]/)[0].trim().slice(0, 32) || 'Image';
}

/**
 * Images into the Designer as raster layers: each its own design (default, "each image a canvas"), or all as
 * layers of one design sized to the first. Only images: video, audio and 3D are skipped (no such layers yet).
 * The current view does not change. No calls, no cost.
 */
export async function chatToDesigner(sessionId: string, opts: { assetIds?: string[]; as?: 'documents' | 'layers' } = {}) {
  const st = get();
  const wanted = opts.assetIds?.length ? opts.assetIds.map((id) => st.assets[id]).filter((a): a is Asset => Boolean(a)) : chatImagesNotInDesigner(sessionId);
  const images = wanted.filter((a) => a.kind === 'image' && a.sessionId === sessionId);
  const skipped = wanted.filter((a) => !images.includes(a)).map((a) => `asset:${a.id} (${a.kind})`);
  const missing = (opts.assetIds ?? []).filter((id) => !st.assets[id]);
  const docs: Array<{ id: string; name: string; layers: number }> = [];
  const previous = st.sessions[sessionId]?.activeDocId;
  const chatIds = new Set(chatImagesNotInDesigner(sessionId, true).map((a) => a.id));
  const existing = st.sessions[sessionId]?.docs.find((d) => d.layers.some((l) => l.type === 'raster' && l.sourceAssetId && chatIds.has(l.sourceAssetId)));
  const sized = (a: Asset) => {
    const k = Math.min(1, 4096 / Math.max(a.width, a.height));
    return [Math.round(a.width * k), Math.round(a.height * k)] as const;
  };
  // One design with every image as a layer by default; a design per image only when asked ("documents").
  if (opts.as !== 'documents' && images.length) {
    const doc = D.createDoc(nameOf(images[0]), ...sized(images[0]), null);
    addDoc(sessionId, doc);
    for (const [i, a] of images.entries()) {
      if (!await placeAsset(sessionId, doc.id, a.id, i ? 'new' : 'base', `${i + 1}. ${nameOf(a)}`)) throw new Error(`Could not place image ${a.id} in the Designer.`);
    }
    docs.push({ id: doc.id, name: doc.name, layers: images.length });
  } else {
    for (const a of images) {
      const doc = D.createDoc(nameOf(a), ...sized(a), null);
      addDoc(sessionId, doc);
      if (!await placeAsset(sessionId, doc.id, a.id, 'base', 'Layer 1')) throw new Error(`Could not place image ${a.id} in the Designer.`);
      docs.push({ id: doc.id, name: doc.name, layers: 1 });
    }
  }
  // The first new design is the one the Designer opens on; with nothing added the active one stays.
  const active = docs[0]?.id ?? (!opts.assetIds?.length ? existing?.id : undefined) ?? previous;
  if (active) patchSession(sessionId, (s0) => ({ ...s0, activeDocId: active }));
  return { docs, skipped, missing, openedExisting: !docs.length && !opts.assetIds?.length ? existing?.id : undefined };
}
