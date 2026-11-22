import { wrongRef } from './wrongRef';
import { directModelRef } from './directModel';
import { refsLimit } from './officialLimits';
import { opSessionId } from './opSession';
import { model3dProblem } from './modelRules';
import { uid } from '../lib/id';
import { deleteAssetBlobs } from '../lib/idb';
import { isAbort } from '../lib/http';
import { randomSeed } from '../lib/rng';
import { ensureSchema, modelsOf, modelSummary, preferredModel, pickComposerModel, selectComposerModel } from './catalog';
import { estimateMedia } from './costs';
import { autoLayout, graphBounds } from './flow/graph';
import { createGeneration, isRunning, opSpec, runGeneration, type GenerationSpec } from './jobs';
import { OPS } from './ops';
import { preferredProviderLabel } from './providers/registry';
import { audioInputProblem, lyricsBody, lyricsParam, songProblem, mentionSubjects, paramByRole, routeVideoInputs, shotsProblem, videoInputProblem } from './params';
import { holdAttemptNode } from './flow/locks';
import { modeFor, placeFor } from './place';
import { sendSessionId, ensureSendSession } from '../store/spaceSession';
import type { Mode, Place } from './placeTypes';
import { overLimit, overLimitText } from './budget';
import { ensureDoc, placeAsset, placeAboveLayer, layerToAsset, getDoc } from './design/actions';
import { deleteBuffers, rasterBufferIds } from './design/raster';
import { dropHistory } from './design/history';
import { designerDims, stopSession } from './agent/runtime';
import type { AdvancedValue, Estimate, Generation, GraphNode, MediaKind, OpId, Workspace } from './types';
import {
  appendFeed,
  autoTitleSession,
  createSession,
  setComposer,
  setComposerMedia,
  setUi,
  toast,
  useStore,
} from '../store/store';
import { keptDrafts } from '../store/homeDrafts';
import { applyEdit, editCompound } from './nodecore/edit';
import { deleteAssets } from './assetActions';

export {
  SUBJECT_KINDS,
  saveSubject,
  deleteSubject,
  libraryItem,
  subjectFromAsset,
  saveSheetViews,
  subjectFromAttachments,
  createRecraftStyle,
  createSubjectVoice,
} from './libraryActions';
export {
  deleteGeneration,
  deleteAssets,
  toggleFavorite,
  copyText,
  addAsReference,
  AGENT_ATTACHABLE,
  toggleAgentAttachment,
  AUDIO_MIME,
  uploadFiles,
  attachFiles,
} from './assetActions';
export { downloadAsset } from './download';

const get = useStore.getState;

function feedBase(workspace: Workspace) {
  return { id: uid('fd'), createdAt: Date.now(), workspace };
}

// ---------------------------------------------------------------------------
// Budget

/** Why a run needs confirmation: it goes over a limit not yet accepted. */
export function budgetProblem(e: Estimate, sessionId?: string): string | null {
  return overLimit(e, sessionId) ? overLimitText(e) : null;
}

// ---------------------------------------------------------------------------
// Composer: direct image / video generation

export interface DirectCheck {
  ok: boolean;
  reason?: string;
  estimate: Estimate;
  /** Goes over the spending limit: ask before running (not a block). */
  overLimit?: boolean;
}

/** Validates the composer for any media kind (button state, and before running). */
export function checkDirect(kind: MediaKind): DirectCheck {
  const st = get();
  const { settings } = st.composer[kind];
  const attachments = st.composer.attachments.filter((id) => st.assets[id]);
  const text = st.composer.text.trim();
  const imageAtt = attachments.filter((id) => st.assets[id]?.kind === 'image');
  const modelRef = directModelRef(kind, st.composer[kind].modelRef, imageAtt.length > 0);
  const schema = st.catalog.schemas[modelRef];
  const estimate = estimateMedia(modelRef, kind, settings, imageAtt.length > 0, false, text.length);
  if (kind === 'audio' && !modelRef) return { ok: false, reason: `Connect ${preferredProviderLabel('audio')} in Settings to generate music.`, estimate };
  if (kind === 'model3d' && !modelRef) return { ok: false, reason: `Connect ${preferredProviderLabel('model3d')} in Settings to generate 3D models.`, estimate };
  if (!schema) return { ok: false, reason: 'Loading model…', estimate };
  if (st.ui.workspace === 'designer' && kind !== 'image') return { ok: false, reason: `Designer layers cannot hold ${kind}.`, estimate };
  if (schema.missing?.length) return { ok: false, reason: `This model needs ${schema.missing.join(', ')}, which the app cannot send yet.`, estimate };
  const audioAtt = attachments.filter((id) => st.assets[id]?.kind === 'audio');
  if (kind === 'image') {
    const audioProblem = audioInputProblem(schema.slots, audioAtt.length);
    if (audioProblem) return { ok: false, reason: `This model ${audioProblem}`, estimate };
    const videoAtt = attachments.filter((id) => st.assets[id]?.kind === 'video');
    const clips = schema.slots.clips;
    if (videoAtt.length && !clips) return { ok: false, reason: 'Remove the video attachment (use Extract frame first).', estimate };
    if (clips && videoAtt.length > clips.max) return { ok: false, reason: `This model takes ${clips.max} reference clip${clips.max > 1 ? 's' : ''}.`, estimate };
    if (clips && videoAtt.length < clips.min) return { ok: false, reason: 'This model needs a reference video clip.', estimate };
    const slot = schema.slots.images;
    if (imageAtt.length && !slot) return { ok: false, reason: 'This model does not accept reference images.', estimate };
    const extra = schema.slots.source ? 1 : 0; // Ideogram Character remix: the first image is the source
    const limit = refsLimit(schema, settings.count);
    if (slot && imageAtt.length > limit) return { ok: false, reason: `This model accepts up to ${limit} images.`, estimate };
    if (slot && imageAtt.length < slot.min + extra) return { ok: false, reason: extra ? 'This model needs a source image first, then reference images.' : 'This model needs an input image.', estimate };
    if (!text && schema.slots.promptRequired !== false && !imageAtt.length) return { ok: false, reason: 'Write a prompt.', estimate };
  } else if (kind === 'model3d') {
    const odd = wrongRef(attachments, st.assets, 'image'); if (odd) return { ok: false, reason: odd, estimate };
    const model = st.catalog.models[modelRef];
    const problem = model ? model3dProblem(model.id, model, text, imageAtt.map((id) => ({ size: 0, width: st.assets[id].width, height: st.assets[id].height }))) : null;
    if (problem) return { ok: false, reason: `This model ${problem.message}`, estimate };
    const limit = refsLimit(schema, settings.count);
    if (schema.slots.images && imageAtt.length > limit) return { ok: false, reason: `This model accepts up to ${limit} image${limit > 1 ? 's' : ''}.`, estimate };
  } else if (kind === 'audio') {
    const odd = wrongRef(attachments, st.assets, 'audio'); if (odd) return { ok: false, reason: odd, estimate };
    const audioProblem = audioInputProblem(schema.slots, audioAtt.length);
    if (audioProblem) return { ok: false, reason: `This model ${audioProblem}`, estimate };
    if (!text && schema.slots.promptRequired) return { ok: false, reason: 'Write a prompt.', estimate };
    const song = songProblem(schema, text, settings);
    if (song) return { ok: false, reason: `This model ${song.message}`, estimate };
  } else {
    const videoAtt = attachments.filter((id) => st.assets[id]?.kind === 'video');
    const routed = routeVideoInputs(schema.slots, imageAtt, videoAtt);
    const problem = videoInputProblem(schema.slots, { firstFrame: Boolean(routed.firstFrame), lastFrame: false, sourceVideo: false, images: routed.images.length, videos: routed.videos.length, audios: audioAtt.length, resolution: settings.resolution });
    if (problem) return { ok: false, reason: `This model ${problem}`, estimate };
    const shots = schema.slots.shots ? shotsProblem(settings.shots, settings.duration) : null;
    if (shots) return { ok: false, reason: `Multi-shot: ${shots}`, estimate };
    const el = schema.slots.elements;
    if (el) {
      const mentioned = mentionSubjects(text, st.library).ids.length;
      if (mentioned > el.max) return { ok: false, reason: `This model takes up to ${el.max} subjects.`, estimate };
    }
    if (!text && !attachments.length && !settings.shots?.length) return { ok: false, reason: 'Write a prompt.', estimate };
    if (!text && schema.slots.promptRequired) return { ok: false, reason: 'Write a prompt.', estimate };
  }
  return { ok: true, estimate, overLimit: overLimit(estimate, sendSessionId(st)) };
}

/** The entries of `map` for these ids, or undefined when there are none. */
function pick<T>(map: Record<string, T> | undefined, ids: string[]): Record<string, T> | undefined {
  const out = Object.fromEntries(ids.filter((id) => map?.[id] !== undefined).map((id) => [id, map![id]]));
  return Object.keys(out).length ? out : undefined;
}

export async function generateDirect(kind: MediaKind): Promise<void> {
  const check = checkDirect(kind);
  if (!check.ok) {
    toast(check.reason ?? 'Cannot generate yet', 'error');
    return;
  }
  const st = get();
  const workspace = st.ui.workspace;
  const sessionId = ensureSendSession();
  const { settings } = st.composer[kind];
  const text = st.composer.text.trim();
  const attachments = st.composer.attachments.filter((id) => st.assets[id]?.kind === 'image');
  const modelRef = directModelRef(kind, st.composer[kind].modelRef, attachments.length > 0);
  const videoAttachments = st.composer.attachments.filter((id) => st.assets[id]?.kind === 'video');
  const audioAttachments = st.composer.attachments.filter((id) => st.assets[id]?.kind === 'audio');
  // Video: the first image is the start frame when the model has one; the rest are references.
  const slots = st.catalog.schemas[modelRef]?.slots ?? {};
  const routed = routeVideoInputs(slots, attachments, videoAttachments);
  const parentId = st.composer.editing?.generationId;
  const spec: GenerationSpec = {
    sessionId,
    // A lyrics model answers with text.
    kind: kind === 'audio' && st.catalog.models[modelRef]?.textOutput ? 'text' : kind,
    prompt: text,
    modelRef,
    // Editing a result keeps its seed, so the edited prompt is the only change (PLAN_PROMPTING.md §4).
    settings: { ...settings, seed: parentId ? settings.seed : undefined },
    inputs: {
      ...(kind === 'image'
        ? { refs: [...attachments, ...videoAttachments, ...audioAttachments] }
        : kind === 'audio'
          ? { refs: audioAttachments }
          : kind === 'model3d'
            ? { refs: attachments }
          : { refs: [...routed.images, ...routed.videos, ...audioAttachments], firstFrame: routed.firstFrame }),
      times: pick(st.composer.times, attachments),
      trims: pick(st.composer.trims, videoAttachments),
    },
    origin: workspace === 'node' ? 'node' : workspace === 'designer' ? 'designer' : 'composer',
    place: placeFor(st.ui, workspace),
    mode: kind,
    parentId,
    estimate: check.estimate,
  };
  autoTitleSession(sessionId, text || (kind === 'image' ? 'Image' : kind === 'video' ? 'Video' : kind === 'model3d' ? '3D model' : 'Music'));
  // Direct generations are recorded by their card (chat), node or layer; no separate chat bubble.
  // The prompt and attachments stay after sending, ready for the next try.
  setComposer({ editing: null });

  if (workspace === 'node') {
    await runInNodes(sessionId, spec);
    return;
  }
  const g = createGeneration(spec);
  if (workspace === 'chat' || workspace === 'designer') appendFeed(sessionId, { ...feedBase(workspace), type: 'generation', generationId: g.id });
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
  // Text comes only from audio models here (lyrics): an audio node with a text output.
  const textOutput = spec.kind === 'text';
  const kind = textOutput ? 'audio' : spec.kind;
  if (kind === 'text') return;
  const promptNode: GraphNode = { id: uid('nd'), position: origin, data: { kind: 'text', title: 'Prompt', text: spec.prompt } };
  // Each input to the port for its kind: the start frame, then references / keyframes, reference videos or clips, audio.
  const port = (assetId: string) => {
    const kind = get().assets[assetId]?.kind;
    if (spec.kind === 'image') return kind === 'video' ? 'clip' : 'ref';
    return kind === 'video' ? 'refVideo' : kind === 'audio' ? 'audio' : 'ref';
  };
  const inputs = [
    ...(spec.inputs?.firstFrame && spec.kind === 'video' ? [{ assetId: spec.inputs.firstFrame, handle: 'first' }] : []),
    ...(spec.inputs?.refs ?? []).map((assetId) => ({ assetId, handle: port(assetId) })),
  ];
  const refNodes: Array<GraphNode & { handle: string }> = inputs.map(({ assetId, handle }) => ({
    id: uid('nd'),
    position: origin,
    data: { kind: 'asset', title: 'Reference', assetId },
    handle,
  }));
  const nodeId = uid('nd');
  const g = createGeneration({ ...spec, stepId: nodeId });
  const genNode: GraphNode = {
    id: nodeId,
    position: origin,
    data: {
      kind,
      title: kind === 'image' ? 'Image' : kind === 'video' ? 'Video' : textOutput ? 'Lyrics' : 'Audio',
      prompt: '',
      modelRef: spec.modelRef,
      settings: spec.settings,
      generationId: g.id,
      outputIndex: 0,
      ...(textOutput ? { textOutput: true } : {}),
    },
  };
  const edges = [
    { id: uid('edge'), source: promptNode.id, target: genNode.id, sourceHandle: 'out', targetHandle: 'prompt' },
    ...refNodes.map((r) => ({ id: uid('edge'), source: r.id, target: genNode.id, sourceHandle: 'out', targetHandle: r.handle })),
  ];
  const nodes: GraphNode[] = [promptNode, ...refNodes.map(({ handle: _h, ...n }) => n), genNode];
  const pos = autoLayout(nodes, edges, origin);
  editCompound(sessionId, 'from-generation', (gr) => ({ ...gr, nodes: [...gr.nodes, ...nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position }))], edges: [...gr.edges, ...edges] }));
  const held = holdAttemptNode(g, get().sessions[sessionId]?.graph.nodes ?? []);
  if (!held) return;
  runGeneration(g.id, held.release).catch((err) => {
    if (!isAbort(err)) toast((err as Error).message, 'error');
  }).finally(held.release);
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
    operationId: g.operationId ?? g.id,
    stepId: g.planId ? undefined : g.stepId,
  };
}

export function regenerateEstimate(generationId: string): Estimate | null {
  const g = get().generations[generationId];
  if (!g) return null;
  if (g.op || g.kind === 'text') return g.estimate;
  return estimateMedia(g.modelRef, g.kind, g.settings, Boolean(g.inputs.refs.length || g.inputs.firstFrame), false, g.prompt.length);
}

/** Run the same request again with a new seed. Call after the user confirmed the cost. */
export async function regenerate(generationId: string): Promise<void> {
  const g = get().generations[generationId];
  if (!g) return;
  const estimate = regenerateEstimate(generationId) ?? g.estimate;
  const problem = budgetProblem(estimate, g.sessionId);
  if (problem) {
    toast(problem, 'error');
    return;
  }
  const spec = specFrom(g);
  const session = get().sessions[g.sessionId];
  // Node generations update their node; everything else appears in the conversation.
  const held = holdAttemptNode(g, session?.graph.nodes ?? []);
  if (!held) return;
  const node = held.node;
  const next = createGeneration({ ...spec, settings: { ...spec.settings, seed: randomSeed() }, estimate });
  if (node) {
    if ('sketchAssetId' in node.data && node.data.sketchAssetId) deleteAssets([node.data.sketchAssetId]);
    applyEdit({ session: g.sessionId, op: { op: 'set', node: node.id, patch: { generationId: next.id, sketchAssetId: undefined } as Partial<GraphNode['data']> } });
  } else {
    appendFeed(g.sessionId, { ...feedBase('chat'), type: 'generation', generationId: next.id });
  }
  runGeneration(next.id, held.release).catch((err) => {
    if (!isAbort(err)) toast((err as Error).message, 'error');
  }).finally(held.release);
}

/** Put lyrics into Audio on a music model and turn off "Write lyrics for me". */
export async function applyLyrics(text: string): Promise<void> {
  const st = get();
  const current = st.composer.audio.modelRef;
  const isMusic = (ref: string) => Boolean(ref && st.catalog.models[ref] && !st.catalog.models[ref].textOutput);
  const preferred = preferredModel('audio');
  const ref = isMusic(current) ? current : isMusic(preferred) ? preferred : modelsOf('audio').find((m) => !m.textOutput)?.ref;
  if (!ref) {
    toast(`No music model is available. Connect ${preferredProviderLabel('audio')} in Settings.`, 'error');
    return;
  }
  if (ref !== current) await selectComposerModel('audio', ref);
  const schema = await ensureSchema(ref);
  const p = lyricsParam(schema ?? undefined);
  if (!p) {
    toast(`${modelSummary(ref)?.name ?? 'This model'} takes no lyrics.`, 'error');
    return;
  }
  const cur = get().composer.audio.settings;
  const advanced = Object.fromEntries(Object.entries(cur.advanced).filter(([k]) => k !== 'lyrics_optimizer'));
  setComposerMedia('audio', { settings: { ...cur, advanced, extras: { ...cur.extras, [p.key]: lyricsBody(text) } } });
  setComposer({ mode: 'audio' });
  setUi((u) => ({ focusComposer: u.focusComposer + 1 }));
  toast('Lyrics placed in Audio mode. Describe the music and generate.', 'info');
}

/** Load a generation back into the composer to tweak and run again. */
export async function editInComposer(generationId: string): Promise<void> {
  const g = get().generations[generationId];
  if (!g) return;
  // Lyrics (text from an audio model) are edited in Audio mode.
  const lyrics = g.kind === 'text' && get().catalog.models[g.modelRef]?.textOutput;
  if (g.op || (g.kind === 'text' && !lyrics)) {
    toast('Operations are edited from their source: open the source asset and apply the operation again.', 'info');
    return;
  }
  const kind = g.kind === 'text' ? 'audio' : g.kind;
  // Editing a result in the composer is a choice of its model.
  await pickComposerModel(kind, g.modelRef);
  setComposer((c) => ({
    mode: kind,
    text: g.prompt,
    attachments: kind === 'image' || kind === 'audio' ? g.inputs.refs.filter((id) => get().assets[id]) : g.inputs.firstFrame && get().assets[g.inputs.firstFrame] ? [g.inputs.firstFrame] : [],
    editing: { generationId },
    [kind]: { ...c[kind], modelRef: g.modelRef, settings: { ...g.settings } },
  }));
  setUi((u) => ({ focusComposer: u.focusComposer + 1 }));
}

// ---------------------------------------------------------------------------
// Operations on assets and layers

export async function opEstimate(assetId: string, op: OpId, params: Record<string, AdvancedValue>, modelRef?: string): Promise<{ estimate: Estimate; modelName: string; modelRef: string; viaNote?: string }> {
  const spec = await opSpec({ sessionId: get().activeSessionId, sourceAssetId: assetId, op, params, origin: 'op', modelRef });
  const ref = spec.modelRef;
  const name = ref === 'local::frame' ? 'Local, free' : modelSummary(ref)?.name ?? get().catalog.transcribers?.[ref]?.name ?? (ref.startsWith('local::') ? 'Local demo' : ref);
  return { estimate: spec.estimate ?? { usd: null, approximate: true }, modelName: name, modelRef: ref };
}

/** Apply an operation to an asset. The result appears as a new generation. Call after cost confirmation. */
export async function runAssetOp(assetId: string, op: OpId, params: Record<string, AdvancedValue>, parentId?: string, modelRef?: string, place?: Place, mode?: Mode): Promise<string[]> {
  const st = get();
  const asset = st.assets[assetId];
  if (!asset) return [];
  const def = OPS[op];
  if (asset.kind !== def.input) {
    toast(`${def.label} needs an ${def.input}.`, 'error');
    return [];
  }
  const sessionId = opSessionId(assetId, true);
  const spec = await opSpec({ sessionId, sourceAssetId: assetId, op, params, origin: 'op', parentId, modelRef, place: place ?? placeFor(st.ui, st.ui.workspace), mode: mode ?? modeFor(st.composer.mode, op) });
  const problem = budgetProblem(spec.estimate ?? { usd: null, approximate: true }, sessionId);
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

/** Designer: run an image operation on a raster layer; the result is a new layer above it (the original is kept). */
export async function runLayerOp(sessionId: string, docId: string, layerId: string, op: OpId, params: Record<string, AdvancedValue>): Promise<void> {
  const def = OPS[op];
  if (def.input !== 'image' || def.output !== 'image') {
    toast(`${def.label} does not produce an image for a layer.`, 'error');
    return;
  }
  try {
    const source = await layerToAsset(sessionId, docId, layerId);
    const spec = await opSpec({ sessionId, sourceAssetId: source.id, op, params, origin: 'designer', place: 'designer', mode: 'image' });
    const problem = budgetProblem(spec.estimate ?? { usd: null, approximate: true }, sessionId);
    if (problem) {
      toast(problem, 'error');
      return;
    }
    const g = createGeneration(spec);
    // Its card in the Designer's conversation, like any generation (also in Generations and Assets).
    appendFeed(sessionId, { ...feedBase('designer'), type: 'generation', generationId: g.id });
    const ids = await runGeneration(g.id);
    const name = getDoc(sessionId, docId)?.layers.find((l) => l.id === layerId)?.name ?? 'Layer';
    if (ids[0]) await placeAboveLayer(sessionId, docId, layerId, ids[0], `${def.label} · ${name}`);
    toast(`${def.label}: new layer above "${name}"`, 'success');
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
  // A generated 3D model comes back as its own 3D node (see addAssetAsNode).
  if (get().assets[assetId]?.kind === 'model3d') return void import('./flow/actions').then((m) => m.addAssetAsNode(sessionId, assetId, pos));
  applyEdit({ session: sessionId, op: { op: 'add', node: { id: uid('nd'), position: pos, data: { kind: 'asset', title: 'Asset', assetId } } } });
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
  stopSession(sessionId);
  // Images of library items outlive the session that made them.
  const kept = new Set(st.library.flatMap((x) => [x.frontalAssetId, ...x.refAssetIds, x.videoAssetId]));
  // Running generations are not canceled (the provider may charge anyway): they finish and jobs.purgeDiscarded removes them.
  const active = new Set(Object.values(st.generations).filter((g) => g.sessionId === sessionId && isRunning(g.id)).map((g) => g.id));
  const assetIds = Object.values(st.assets).filter((a) => a.sessionId === sessionId && !kept.has(a.id) && !(a.generationId && active.has(a.generationId))).map((a) => a.id);
  const genIds = Object.values(st.generations).filter((g) => g.sessionId === sessionId && !active.has(g.id)).map((g) => g.id);
  const rasterIds = rasterBufferIds(s.docs.flatMap((d) => d.layers));
  useStore.setState((cur) => {
    const sessions = { ...cur.sessions };
    delete sessions[sessionId];
    const assets = { ...cur.assets };
    assetIds.forEach((id) => delete assets[id]);
    const generations = { ...cur.generations };
    genIds.forEach((id) => delete generations[id]);
    active.forEach((id) => { if (generations[id]) generations[id] = { ...generations[id], discard: true }; });
    let activeSessionId = cur.activeSessionId;
    if (activeSessionId === sessionId || !sessions[activeSessionId]) {
      const next = Object.values(sessions).filter((x) => !x.hidden && !x.archived).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (next) activeSessionId = next.id;
      else { const fresh = createSession(); sessions[fresh.id] = fresh; activeSessionId = fresh.id; }
    }
    return { sessions, assets, generations, activeSessionId, ui: { ...cur.ui, homeDrafts: keptDrafts(cur.ui.homeDrafts, sessions) } };
  });
  void deleteAssetBlobs(assetIds);
  void deleteBuffers(rasterIds);
  s.docs.forEach((d) => dropHistory(d.id));
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
  if (kind === 'image') return { accepts: Boolean(schema?.slots.images), max: refsLimit(schema, st.composer.image.settings.count) };
  const slots = schema?.slots ?? {};
  const refs = refsLimit(schema, st.composer.video.settings.count);
  return { accepts: Boolean(slots.firstFrame || refs), max: (slots.firstFrame && !slots.keyframes ? 1 : 0) + refs };
}

export function hasParam(kind: MediaKind, role: Parameters<typeof paramByRole>[1]): boolean {
  const st = get();
  return Boolean(paramByRole(st.catalog.schemas[st.composer[kind].modelRef], role));
}
