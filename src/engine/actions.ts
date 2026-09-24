import { uid } from '../lib/id';
import { formatUsd } from '../lib/format';
import { deleteAssetBlobs, getAssetBlob, loadAssetUrl, putAssetBlob } from '../lib/idb';
import { downloadBlob, extensionForMime, fetchBlob, probeMedia } from '../lib/media';
import { isAbort } from '../lib/http';
import { randomSeed } from '../lib/rng';
import { ensureSchema, modelSummary, selectComposerModel } from './catalog';
import { estimateMedia } from './costs';
import { autoLayout, graphBounds } from './flow/graph';
import { createGeneration, opSpec, runGeneration, type GenerationSpec } from './jobs';
import { OPS } from './ops';
import { paramByRole } from './params';
import { needsSpendCheck } from './pricing';
import { ensureDoc, placeAsset, replaceLayerPixels, layerToAsset, getDoc } from './design/actions';
import { deleteBuffers } from './design/raster';
import { designerDims } from './agent/runtime';
import type { AdvancedValue, Asset, Estimate, Generation, GraphNode, MediaKind, OpId, Workspace } from './types';
import {
  addAssets,
  appendFeed,
  autoTitleSession,
  newSession,
  setComposer,
  setGraph,
  setUi,
  toast,
  useStore,
} from '../store/store';

const get = useStore.getState;

function feedBase(workspace: Workspace) {
  return { id: uid('fd'), createdAt: Date.now(), workspace };
}

// ---------------------------------------------------------------------------
// Budget

export function budgetProblem(e: Estimate): string | null {
  const st = get();
  const remaining = st.settings.budgetUsd - st.spentUsd;
  if (e.usd != null && e.usd > remaining + 1e-9) {
    return `Needs ${formatUsd(e.usd)} but only ${formatUsd(Math.max(0, remaining))} of your budget is left. Raise it in Settings.`;
  }
  return null;
}

export { needsSpendCheck };

// ---------------------------------------------------------------------------
// Composer: direct image / video generation

export interface DirectCheck {
  ok: boolean;
  reason?: string;
  estimate: Estimate;
}

/** Validate the composer for image/video mode (used for the button state and before running). */
export function checkDirect(kind: MediaKind): DirectCheck {
  const st = get();
  const { modelRef, settings } = st.composer[kind];
  const schema = st.catalog.schemas[modelRef];
  const attachments = st.composer.attachments.filter((id) => st.assets[id]);
  const text = st.composer.text.trim();
  const imageAtt = attachments.filter((id) => st.assets[id]?.kind === 'image');
  const estimate = estimateMedia(modelRef, kind, settings, imageAtt.length > 0);
  if (!schema) return { ok: false, reason: 'Loading model…', estimate };
  if (st.ui.workspace === 'designer' && kind === 'video') return { ok: false, reason: 'Designer layers cannot hold video.', estimate };
  if (attachments.some((id) => st.assets[id]?.kind === 'video')) return { ok: false, reason: 'Remove the video attachment (use Extract frame first).', estimate };
  if (kind === 'image') {
    const slot = schema.slots.images;
    if (imageAtt.length && !slot) return { ok: false, reason: 'This model does not accept reference images.', estimate };
    if (slot && imageAtt.length > slot.max) return { ok: false, reason: `This model accepts up to ${slot.max} images.`, estimate };
    if (slot && imageAtt.length < slot.min) return { ok: false, reason: 'This model needs an input image.', estimate };
    if (!text && schema.slots.promptRequired !== false && !imageAtt.length) return { ok: false, reason: 'Write a prompt.', estimate };
  } else {
    if (imageAtt.length > 1) return { ok: false, reason: 'Video takes one start frame.', estimate };
    if (imageAtt.length && !schema.slots.firstFrame) return { ok: false, reason: 'This model cannot start from an image.', estimate };
    if (!text && !imageAtt.length) return { ok: false, reason: 'Write a prompt.', estimate };
    if (!text && schema.slots.promptRequired) return { ok: false, reason: 'Write a prompt.', estimate };
  }
  const budget = budgetProblem(estimate);
  if (budget) return { ok: false, reason: budget, estimate };
  return { ok: true, estimate };
}

export async function generateDirect(kind: MediaKind): Promise<void> {
  const check = checkDirect(kind);
  if (!check.ok) {
    toast(check.reason ?? 'Cannot generate yet', 'error');
    return;
  }
  const st = get();
  const sessionId = st.activeSessionId;
  const workspace = st.ui.workspace;
  const { modelRef, settings } = st.composer[kind];
  const text = st.composer.text.trim();
  const attachments = st.composer.attachments.filter((id) => st.assets[id]?.kind === 'image');
  const parentId = st.composer.editing?.generationId;
  const spec: GenerationSpec = {
    sessionId,
    kind,
    prompt: text,
    modelRef,
    settings: { ...settings, seed: undefined },
    inputs: kind === 'image' ? { refs: attachments } : { refs: [], firstFrame: attachments[0] },
    origin: workspace === 'node' ? 'node' : workspace === 'designer' ? 'designer' : 'composer',
    parentId,
    estimate: check.estimate,
  };
  autoTitleSession(sessionId, text || 'Image');
  // Direct generations are recorded by their card (chat), node or layer; no separate chat bubble.
  setComposer({ text: '', attachments: [], editing: null });

  if (workspace === 'node') {
    await runInNodes(sessionId, spec);
    return;
  }
  const g = createGeneration(spec);
  if (workspace === 'chat') appendFeed(sessionId, { ...feedBase(workspace), type: 'generation', generationId: g.id });
  if (workspace === 'designer') {
    // The doc exists before the image arrives so it lands where the user is working.
    const doc = ensureDoc(sessionId, designerDims());
    const target = st.composer.designerTarget;
    try {
      const assetIds = await runGeneration(g.id);
      if (assetIds[0]) {
        const current = getDoc(sessionId, doc.id);
        const where = !current?.layers.length ? 'base' : target === 'replace' ? 'replace' : 'new';
        await placeAsset(sessionId, doc.id, assetIds[0], where, truncateName(text));
      }
    } catch (err) {
      if (!isAbort(err)) toast((err as Error).message, 'error');
    }
    return;
  }
  runGeneration(g.id).catch((err) => {
    if (!isAbort(err)) toast((err as Error).message, 'error');
  });
}

function truncateName(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 28 ? `${t.slice(0, 27)}…` : t || 'Image';
}

/** Image/video mode in the Node workspace: a prompt node wired into a generation node, then run. */
async function runInNodes(sessionId: string, spec: GenerationSpec): Promise<void> {
  const graph = get().sessions[sessionId].graph;
  const bounds = graphBounds(graph.nodes);
  const origin = bounds ? { x: bounds.x, y: bounds.y + bounds.h + 120 } : { x: 0, y: 0 };
  const promptNode: GraphNode = { id: uid('nd'), position: origin, data: { kind: 'text', title: 'Prompt', text: spec.prompt } };
  const refNodes: GraphNode[] = (spec.inputs?.refs.length ? spec.inputs.refs : spec.inputs?.firstFrame ? [spec.inputs.firstFrame] : []).map((assetId) => ({
    id: uid('nd'),
    position: origin,
    data: { kind: 'asset', title: 'Reference', assetId },
  }));
  const g = createGeneration(spec);
  const genNode: GraphNode = {
    id: uid('nd'),
    position: origin,
    data: { kind: spec.kind, title: spec.kind === 'image' ? 'Image' : 'Video', prompt: '', modelRef: spec.modelRef, settings: spec.settings, generationId: g.id, outputIndex: 0 },
  };
  const edges = [
    { id: uid('edge'), source: promptNode.id, target: genNode.id, sourceHandle: 'out', targetHandle: 'prompt' },
    ...refNodes.map((r) => ({ id: uid('edge'), source: r.id, target: genNode.id, sourceHandle: 'out', targetHandle: spec.kind === 'image' ? 'ref' : 'first' })),
  ];
  const nodes = [promptNode, ...refNodes, genNode];
  const pos = autoLayout(nodes, edges, origin);
  setGraph(sessionId, (gr) => ({ ...gr, nodes: [...gr.nodes, ...nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position }))], edges: [...gr.edges, ...edges] }));
  runGeneration(g.id).catch((err) => {
    if (!isAbort(err)) toast((err as Error).message, 'error');
  });
}

// ---------------------------------------------------------------------------
// Generation card actions

function specFrom(g: Generation): GenerationSpec {
  return {
    sessionId: g.sessionId,
    kind: g.kind,
    prompt: g.prompt,
    modelRef: g.modelRef,
    settings: g.settings,
    inputs: g.inputs,
    op: g.op,
    origin: g.origin,
    parentId: g.id,
    planId: g.planId,
    stepId: g.stepId,
  };
}

export function regenerateEstimate(generationId: string): Estimate | null {
  const g = get().generations[generationId];
  if (!g) return null;
  if (g.op) return g.estimate;
  return estimateMedia(g.modelRef, g.kind, g.settings, Boolean(g.inputs.refs.length || g.inputs.firstFrame));
}

/** Run the same request again with a new seed. Call after the user confirmed the cost. */
export async function regenerate(generationId: string): Promise<void> {
  const g = get().generations[generationId];
  if (!g) return;
  const estimate = regenerateEstimate(generationId) ?? g.estimate;
  const problem = budgetProblem(estimate);
  if (problem) {
    toast(problem, 'error');
    return;
  }
  const spec = specFrom(g);
  const next = createGeneration({ ...spec, settings: { ...spec.settings, seed: randomSeed() }, estimate });
  const session = get().sessions[g.sessionId];
  // Node generations update their node; everything else appears in the conversation.
  const node = session?.graph.nodes.find((n) => (n.data.kind === 'image' || n.data.kind === 'video' || n.data.kind === 'tool') && n.data.generationId === g.id);
  if (node) {
    if (node.data.kind !== 'text' && node.data.sketchAssetId) deleteAssets([node.data.sketchAssetId]);
    setGraph(g.sessionId, (gr) => ({ ...gr, nodes: gr.nodes.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, generationId: next.id, sketchAssetId: undefined } as GraphNode['data'] } : n)) }));
  } else {
    appendFeed(g.sessionId, { ...feedBase('chat'), type: 'generation', generationId: next.id });
  }
  runGeneration(next.id).catch((err) => {
    if (!isAbort(err)) toast((err as Error).message, 'error');
  });
}

/** Load a generation back into the composer to tweak and run again. */
export async function editInComposer(generationId: string): Promise<void> {
  const g = get().generations[generationId];
  if (!g) return;
  if (g.op) {
    toast('Operations are edited from their source: open the source asset and apply the operation again.', 'info');
    return;
  }
  await selectComposerModel(g.kind, g.modelRef);
  setComposer((c) => ({
    mode: g.kind,
    text: g.prompt,
    attachments: g.kind === 'image' ? g.inputs.refs.filter((id) => get().assets[id]) : g.inputs.firstFrame && get().assets[g.inputs.firstFrame] ? [g.inputs.firstFrame] : [],
    editing: { generationId },
    [g.kind]: { ...c[g.kind], modelRef: g.modelRef, settings: { ...g.settings, seed: undefined } },
  }));
  setUi((u) => ({ focusComposer: u.focusComposer + 1 }));
}

export function deleteGeneration(generationId: string): void {
  const g = get().generations[generationId];
  if (!g) return;
  const assetIds = [...g.assetIds];
  useStore.setState((st) => {
    const generations = { ...st.generations };
    delete generations[generationId];
    const assets = { ...st.assets };
    for (const id of assetIds) delete assets[id];
    const s = st.sessions[g.sessionId];
    const sessions = s
      ? {
          ...st.sessions,
          [g.sessionId]: {
            ...s,
            feed: s.feed.filter((f) => !(f.type === 'generation' && f.generationId === generationId)),
            graph: {
              ...s.graph,
              nodes: s.graph.nodes.map((n) =>
                (n.data.kind === 'image' || n.data.kind === 'video' || n.data.kind === 'tool') && n.data.generationId === generationId
                  ? { ...n, data: { ...n.data, generationId: undefined } as GraphNode['data'] }
                  : n,
              ),
            },
          },
        }
      : st.sessions;
    const composer = { ...st.composer, attachments: st.composer.attachments.filter((a) => !assetIds.includes(a)) };
    return { generations, assets, sessions, composer };
  });
  void deleteAssetBlobs(assetIds);
}

export function deleteAssets(ids: string[]): void {
  if (!ids.length) return;
  const set = new Set(ids);
  useStore.setState((st) => {
    const assets = { ...st.assets };
    ids.forEach((id) => delete assets[id]);
    const generations = { ...st.generations };
    for (const g of Object.values(st.generations)) {
      if (g.assetIds.some((a) => set.has(a))) generations[g.id] = { ...g, assetIds: g.assetIds.filter((a) => !set.has(a)) };
    }
    return { assets, generations, composer: { ...st.composer, attachments: st.composer.attachments.filter((a) => !set.has(a)) } };
  });
  void deleteAssetBlobs(ids);
}

export function toggleFavorite(assetId: string): void {
  useStore.setState((st) => {
    const a = st.assets[assetId];
    return a ? { assets: { ...st.assets, [assetId]: { ...a, favorite: !a.favorite } } } : {};
  });
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied', 'success');
  } catch {
    toast('Clipboard is not available', 'error');
  }
}

export async function downloadAsset(assetId: string): Promise<void> {
  const a = get().assets[assetId];
  if (!a) return;
  try {
    let blob = await getAssetBlob(assetId);
    if (!blob && a.remoteUrl) blob = await fetchBlob(a.remoteUrl);
    if (!blob) throw new Error('File not available');
    downloadBlob(blob, `ogs-${assetId.slice(-8)}.${extensionForMime(blob.type || a.mime)}`);
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}

export function useAsReference(assetId: string): void {
  const st = get();
  const a = st.assets[assetId];
  if (!a) return;
  if (a.kind === 'video') {
    toast('Videos cannot be references. Extract a frame first.', 'error');
    return;
  }
  setComposer((c) => ({ attachments: c.attachments.includes(assetId) ? c.attachments : [...c.attachments, assetId] }));
  setUi((u) => ({ focusComposer: u.focusComposer + 1, lightbox: null }));
}

export async function uploadFiles(files: File[]): Promise<string[]> {
  const st = get();
  const sessionId = st.activeSessionId;
  const out: Asset[] = [];
  for (const f of files) {
    if (!/^image\/(png|jpeg|webp|gif)$|^video\/(mp4|webm|quicktime)$/.test(f.type)) {
      toast(`${f.name}: unsupported file type`, 'error');
      continue;
    }
    if (f.size > 60 * 1024 * 1024) {
      toast(`${f.name}: file is larger than 60 MB`, 'error');
      continue;
    }
    try {
      const info = await probeMedia(f);
      const id = uid('ast');
      await putAssetBlob(id, f);
      out.push({
        id,
        kind: f.type.startsWith('video/') ? 'video' : 'image',
        mime: f.type,
        width: info.width,
        height: info.height,
        duration: info.duration,
        sessionId,
        origin: 'upload',
        stored: true,
        favorite: false,
        createdAt: Date.now(),
      });
    } catch {
      toast(`${f.name}: could not read the file`, 'error');
    }
  }
  addAssets(out);
  return out.map((a) => a.id);
}

export async function attachFiles(files: File[]): Promise<void> {
  const ids = await uploadFiles(files);
  if (ids.length) setComposer((c) => ({ attachments: [...c.attachments, ...ids] }));
}

// ---------------------------------------------------------------------------
// Operations on assets and layers

export async function opEstimate(assetId: string, op: OpId, params: Record<string, AdvancedValue>): Promise<{ estimate: Estimate; modelName: string; viaNote?: string }> {
  const spec = await opSpec({ sessionId: get().activeSessionId, sourceAssetId: assetId, op, params, origin: 'op' });
  const name = spec.modelRef === 'local::frame' ? 'Local, free' : modelSummary(spec.modelRef)?.name ?? (spec.modelRef.startsWith('local::') ? 'Local demo' : spec.modelRef);
  return { estimate: spec.estimate ?? { usd: null, approximate: true }, modelName: name };
}

/** Apply an operation to an asset. The result appears as a new generation. Call after cost confirmation. */
export async function runAssetOp(assetId: string, op: OpId, params: Record<string, AdvancedValue>, parentId?: string): Promise<string[]> {
  const st = get();
  const asset = st.assets[assetId];
  if (!asset) return [];
  const def = OPS[op];
  if (asset.kind !== def.input) {
    toast(`${def.label} needs an ${def.input}.`, 'error');
    return [];
  }
  const sessionId = asset.sessionId && st.sessions[asset.sessionId] ? asset.sessionId : st.activeSessionId;
  const spec = await opSpec({ sessionId, sourceAssetId: assetId, op, params, origin: 'op', parentId });
  const problem = budgetProblem(spec.estimate ?? { usd: null, approximate: true });
  if (problem) {
    toast(problem, 'error');
    return [];
  }
  const g = createGeneration(spec);
  appendFeed(sessionId, { ...feedBase('chat'), type: 'generation', generationId: g.id });
  try {
    return await runGeneration(g.id);
  } catch (err) {
    if (!isAbort(err)) toast((err as Error).message, 'error');
    return [];
  }
}

/** Designer: run an image operation on the active raster layer and replace its pixels. */
export async function runLayerOp(sessionId: string, docId: string, layerId: string, op: OpId, params: Record<string, AdvancedValue>): Promise<void> {
  const def = OPS[op];
  if (def.input !== 'image' || def.output !== 'image') {
    toast(`${def.label} does not produce an image for a layer.`, 'error');
    return;
  }
  try {
    const source = await layerToAsset(sessionId, docId, layerId);
    const spec = await opSpec({ sessionId, sourceAssetId: source.id, op, params, origin: 'designer' });
    const problem = budgetProblem(spec.estimate ?? { usd: null, approximate: true });
    if (problem) {
      toast(problem, 'error');
      return;
    }
    const g = createGeneration(spec);
    const ids = await runGeneration(g.id);
    if (ids[0]) await replaceLayerPixels(sessionId, docId, layerId, ids[0]);
    toast(`${def.label} applied to the layer`, 'success');
  } catch (err) {
    if (!isAbort(err)) toast((err as Error).message, 'error');
  }
}

export async function layerOpEstimate(sessionId: string, docId: string, layerId: string, op: OpId, params: Record<string, AdvancedValue>): Promise<Estimate> {
  const doc = getDoc(sessionId, docId);
  const layer = doc?.layers.find((l) => l.id === layerId);
  if (!layer || layer.type !== 'raster') return { usd: null, approximate: true };
  const spec = await opSpec({ sessionId, sourceAssetId: '', sourceDims: { width: layer.pxWidth, height: layer.pxHeight }, op, params, origin: 'designer' });
  return spec.estimate ?? { usd: null, approximate: true };
}

// ---------------------------------------------------------------------------
// Graph helpers

export function addAssetNode(sessionId: string, assetId: string, position?: { x: number; y: number }): void {
  const graph = get().sessions[sessionId]?.graph;
  if (!graph) return;
  const bounds = graphBounds(graph.nodes);
  const pos = position ?? (bounds ? { x: bounds.x, y: bounds.y + bounds.h + 80 } : { x: 0, y: 0 });
  setGraph(sessionId, (g) => ({ ...g, nodes: [...g.nodes, { id: uid('nd'), position: pos, data: { kind: 'asset', title: 'Asset', assetId } }] }));
}

export function sendToNodes(assetId: string): void {
  const st = get();
  addAssetNode(st.activeSessionId, assetId);
  setUi({ workspace: 'node', lightbox: null, panel: null });
  toast('Added to the node canvas', 'success');
}

// ---------------------------------------------------------------------------
// Sessions

export function deleteSession(sessionId: string): void {
  const st = get();
  const s = st.sessions[sessionId];
  if (!s) return;
  const assetIds = Object.values(st.assets).filter((a) => a.sessionId === sessionId).map((a) => a.id);
  const genIds = Object.values(st.generations).filter((g) => g.sessionId === sessionId).map((g) => g.id);
  const rasterIds = s.docs.flatMap((d) => d.layers.filter((l) => l.type === 'raster').map((l) => l.id));
  useStore.setState((cur) => {
    const sessions = { ...cur.sessions };
    delete sessions[sessionId];
    const assets = { ...cur.assets };
    assetIds.forEach((id) => delete assets[id]);
    const generations = { ...cur.generations };
    genIds.forEach((id) => delete generations[id]);
    let activeSessionId = cur.activeSessionId;
    if (activeSessionId === sessionId || !sessions[activeSessionId]) {
      const next = Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (next) activeSessionId = next.id;
    }
    return { sessions, assets, generations, activeSessionId };
  });
  // Always keep one session.
  if (!Object.keys(get().sessions).length) newSession();
  void deleteAssetBlobs(assetIds);
  void deleteBuffers(rasterIds);
}

export async function assetObjectUrl(assetId: string): Promise<string | null> {
  return (await loadAssetUrl(assetId)) ?? get().assets[assetId]?.remoteUrl ?? null;
}

export function schemaReady(ref: string): boolean {
  return Boolean(get().catalog.schemas[ref]);
}

export async function prepareModel(ref: string): Promise<void> {
  await ensureSchema(ref);
}

export function acceptsImages(kind: MediaKind): { accepts: boolean; max: number } {
  const st = get();
  const schema = st.catalog.schemas[st.composer[kind].modelRef];
  if (kind === 'image') return { accepts: Boolean(schema?.slots.images), max: schema?.slots.images?.max ?? 0 };
  return { accepts: Boolean(schema?.slots.firstFrame), max: schema?.slots.firstFrame ? 1 : 0 };
}

export function hasParam(kind: MediaKind, role: Parameters<typeof paramByRole>[1]): boolean {
  const st = get();
  return Boolean(paramByRole(st.catalog.schemas[st.composer[kind].modelRef], role));
}
