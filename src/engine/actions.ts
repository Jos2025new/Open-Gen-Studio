import { model3dProblem } from './modelRules';
import { GLB_MIME, validateGlb } from '../lib/model3d';
import { uid } from '../lib/id';
import { formatUsd } from '../lib/format';
import { deleteAssetBlobs, getAssetBlob, loadAssetUrl, putAssetBlob } from '../lib/idb';
import { downloadBlob, extensionForMime, fetchBlob, probeMedia } from '../lib/media';
import { isAbort } from '../lib/http';
import { randomSeed } from '../lib/rng';
import { ensureSchema, modelsOf, modelSummary, preferredModel, RECRAFT_STYLE_REF, selectComposerModel } from './catalog';
import { estimateMedia } from './costs';
import { autoLayout, graphBounds, runsGeneration } from './flow/graph';
import { createGeneration, opSpec, runGeneration, type GenerationSpec } from './jobs';
import { OPS } from './ops';
import { audioInputProblem, lyricsBody, lyricsParam, songProblem, mentionSubjects, paramByRole, routeVideoInputs, shotsProblem, videoInputProblem } from './params';
import { needsSpendCheck } from './pricing';
import { ensureDoc, placeAsset, replaceLayerPixels, layerToAsset, getDoc } from './design/actions';
import { deleteBuffers } from './design/raster';
import { designerDims } from './agent/runtime';
import type { AdvancedValue, Asset, Estimate, Generation, GraphNode, MediaKind, OpId, Subject, Workspace } from './types';
import {
  addAssets,
  appendFeed,
  autoTitleSession,
  newSession,
  patchSession,
  setComposer,
  setComposerMedia,
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
// Subjects (Kling elements), per session

export function saveSubject(sessionId: string, subject: Subject): void {
  patchSession(sessionId, (s) => {
    const list = s.subjects ?? [];
    return { ...s, subjects: list.some((x) => x.id === subject.id) ? list.map((x) => (x.id === subject.id ? subject : x)) : [...list, subject] };
  });
}

export function deleteSubject(sessionId: string, id: string): void {
  patchSession(sessionId, (s) => ({ ...s, subjects: (s.subjects ?? []).filter((x) => x.id !== id) }));
}

/** "Save as subject" on an image: that image is the frontal view of a new subject of the session. */
export function subjectFromAsset(sessionId: string, assetId: string, name: string): Subject | null {
  const clean = name.trim().replace(/^@/, '');
  if (!clean || get().assets[assetId]?.kind !== 'image') return null;
  const subject: Subject = { id: uid('sub'), name: clean, frontalAssetId: assetId, refAssetIds: [] };
  saveSubject(sessionId, subject);
  toast(`Saved as @${clean}: mention it in any prompt`, 'success');
  return subject;
}

/** A new subject from the composer attachments: the first image is the frontal view, up to 3 more are views; or a video. */
export function subjectFromAttachments(name: string): Subject | null {
  const st = get();
  const images = st.composer.attachments.filter((id) => st.assets[id]?.kind === 'image');
  const video = st.composer.attachments.find((id) => st.assets[id]?.kind === 'video');
  const clean = name.trim().replace(/^@/, '');
  if (!clean || (!images.length && !video)) return null;
  const subject: Subject = { id: uid('sub'), name: clean, frontalAssetId: images[0], refAssetIds: images.slice(1, 4), videoAssetId: images.length ? undefined : video };
  saveSubject(st.activeSessionId, subject);
  const used = new Set([subject.frontalAssetId, ...subject.refAssetIds, subject.videoAssetId]);
  setComposer((c) => ({ attachments: c.attachments.filter((a) => !used.has(a)) }));
  return subject;
}

/** Create a Recraft V4 style (fal) from the attached images, save it in the session and select it. Call after cost confirmation. */
export async function createRecraftStyle(sessionId: string, name: string): Promise<void> {
  const st = get();
  const images = st.composer.attachments.filter((id) => st.assets[id]?.kind === 'image').slice(0, 10);
  if (!images.length) {
    toast('Attach 1–10 reference images first.', 'error');
    return;
  }
  const g = createGeneration({ sessionId, kind: 'text', prompt: `Create Recraft style “${name}”`, modelRef: RECRAFT_STYLE_REF, settings: { count: 1, advanced: {} }, inputs: { refs: images }, origin: 'composer', estimate: { usd: null, approximate: true, note: 'fal bills the style when it is created' } });
  appendFeed(sessionId, { ...feedBase('chat'), type: 'generation', generationId: g.id });
  try {
    await runGeneration(g.id);
    const styleId = get().generations[g.id]?.text;
    if (!styleId) return;
    patchSession(sessionId, (s) => ({ ...s, styles: [...(s.styles ?? []), { id: uid('sty'), name: name.trim() || 'Style', family: 'recraft-v4', styleId }] }));
    const cur = get().composer.image.settings;
    setComposerMedia('image', { settings: { ...cur, extras: { ...cur.extras, style_id: styleId } } });
    toast(`Style “${name}” saved and selected.`, 'info');
  } catch (err) {
    if (!isAbort(err)) toast((err as Error).message, 'error');
  }
}

/** Create a Kling voice (fal) from the attached audio and bind it to the subject when it is ready. Call after cost confirmation. */
export async function createSubjectVoice(sessionId: string, subjectId: string): Promise<void> {
  const st = get();
  const audio = st.composer.attachments.find((id) => st.assets[id]?.kind === 'audio');
  if (!audio) {
    toast('Attach 5–30 s of clean speech first.', 'error');
    return;
  }
  try {
    const spec = await opSpec({ sessionId, sourceAssetId: audio, op: 'create_voice', params: {}, origin: 'op' });
    const g = createGeneration(spec);
    appendFeed(sessionId, { ...feedBase('chat'), type: 'generation', generationId: g.id });
    await runGeneration(g.id);
    const voiceId = get().generations[g.id]?.text;
    const subject = get().sessions[sessionId]?.subjects?.find((x) => x.id === subjectId);
    if (voiceId && subject) {
      saveSubject(sessionId, { ...subject, voiceId });
      toast(`Voice bound to @${subject.name}.`, 'info');
    }
  } catch (err) {
    if (!isAbort(err)) toast((err as Error).message, 'error');
  }
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
  if (kind === 'audio' && !modelRef) return { ok: false, reason: 'Connect Atlas Cloud in Settings to generate music.', estimate };
  if (kind === 'model3d' && !modelRef) return { ok: false, reason: 'Connect Atlas Cloud or NanoGPT in Settings to generate 3D models.', estimate };
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
    // A `source` slot (Ideogram Character remix) takes the first image; the rest are references.
    const extra = schema.slots.source ? 1 : 0;
    if (slot && imageAtt.length > slot.max + extra) return { ok: false, reason: `This model accepts up to ${slot.max + extra} images.`, estimate };
    if (slot && imageAtt.length < slot.min + extra) return { ok: false, reason: extra ? 'This model needs a source image first, then reference images.' : 'This model needs an input image.', estimate };
    if (!text && schema.slots.promptRequired !== false && !imageAtt.length) return { ok: false, reason: 'Write a prompt.', estimate };
  } else if (kind === 'model3d') {
    if (attachments.length > imageAtt.length) return { ok: false, reason: '3D models take only reference images.', estimate };
    const model = st.catalog.models[modelRef];
    const problem = model ? model3dProblem(model.id, model, text, imageAtt.map((id) => ({ size: 0, width: st.assets[id].width, height: st.assets[id].height }))) : null;
    if (problem) return { ok: false, reason: `This model ${problem.message}`, estimate };
    const slot = schema.slots.images;
    if (slot && imageAtt.length > slot.max) return { ok: false, reason: `This model accepts up to ${slot.max} image${slot.max > 1 ? 's' : ''}.`, estimate };
  } else if (kind === 'audio') {
    if (attachments.length > audioAtt.length) return { ok: false, reason: 'Music models take no images or videos.', estimate };
    const audioProblem = audioInputProblem(schema.slots, audioAtt.length);
    if (audioProblem) return { ok: false, reason: `This model ${audioProblem}`, estimate };
    if (!text && schema.slots.promptRequired) return { ok: false, reason: 'Write a prompt.', estimate };
    const song = songProblem(schema, text, settings);
    if (song) return { ok: false, reason: `This model ${song.message}`, estimate };
  } else {
    const videoAtt = attachments.filter((id) => st.assets[id]?.kind === 'video');
    const routed = routeVideoInputs(schema.slots, imageAtt, videoAtt);
    const problem = videoInputProblem(schema.slots, { firstFrame: Boolean(routed.firstFrame), images: routed.images.length, videos: routed.videos.length, audios: audioAtt.length });
    if (problem) return { ok: false, reason: `This model ${problem}`, estimate };
    const shots = schema.slots.shots ? shotsProblem(settings.shots, settings.duration) : null;
    if (shots) return { ok: false, reason: `Multi-shot: ${shots}`, estimate };
    const el = schema.slots.elements;
    if (el) {
      const mentioned = mentionSubjects(text, st.sessions[st.activeSessionId]?.subjects ?? []).ids.length;
      if (mentioned > el.max) return { ok: false, reason: `This model takes up to ${el.max} subjects.`, estimate };
    }
    if (!text && !attachments.length && !settings.shots?.length) return { ok: false, reason: 'Write a prompt.', estimate };
    if (!text && schema.slots.promptRequired) return { ok: false, reason: 'Write a prompt.', estimate };
  }
  const budget = budgetProblem(estimate);
  if (budget) return { ok: false, reason: budget, estimate };
  return { ok: true, estimate };
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
  const sessionId = st.activeSessionId;
  const workspace = st.ui.workspace;
  const { modelRef, settings } = st.composer[kind];
  const text = st.composer.text.trim();
  const attachments = st.composer.attachments.filter((id) => st.assets[id]?.kind === 'image');
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
    settings: { ...settings, seed: undefined },
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
    parentId,
    estimate: check.estimate,
  };
  autoTitleSession(sessionId, text || (kind === 'image' ? 'Image' : kind === 'video' ? 'Video' : kind === 'model3d' ? '3D model' : 'Music'));
  // Direct generations are recorded by their card (chat), node or layer; no separate chat bubble.
  setComposer({ text: '', attachments: [], times: {}, trims: {}, editing: null });

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
  const g = createGeneration(spec);
  const genNode: GraphNode = {
    id: uid('nd'),
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
  if (g.op || g.kind === 'text') return g.estimate;
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
  const node = session?.graph.nodes.find((n) => runsGeneration(n.data) && n.data.generationId === g.id);
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

/**
 * Put song lyrics (a MiniMax Lyrics result, a transcription…) into Audio mode on a music model: the selected one,
 * or the preferred music model when a lyrics model is selected. "Write lyrics for me" is turned off, since the
 * model rejects it together with given lyrics.
 */
export async function applyLyrics(text: string): Promise<void> {
  const st = get();
  const current = st.composer.audio.modelRef;
  const isMusic = (ref: string) => Boolean(ref && st.catalog.models[ref] && !st.catalog.models[ref].textOutput);
  const preferred = preferredModel('audio');
  const ref = isMusic(current) ? current : isMusic(preferred) ? preferred : modelsOf('audio').find((m) => !m.textOutput)?.ref;
  if (!ref) {
    toast('No music model is available. Connect Atlas Cloud in Settings.', 'error');
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
  await selectComposerModel(kind, g.modelRef);
  setComposer((c) => ({
    mode: kind,
    text: g.prompt,
    attachments: kind === 'image' || kind === 'audio' ? g.inputs.refs.filter((id) => get().assets[id]) : g.inputs.firstFrame && get().assets[g.inputs.firstFrame] ? [g.inputs.firstFrame] : [],
    editing: { generationId },
    [kind]: { ...c[kind], modelRef: g.modelRef, settings: { ...g.settings, seed: undefined } },
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
                runsGeneration(n.data) && n.data.generationId === generationId
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

/** Audio files the app stores and the providers read (MP3, WAV, M4A, AAC, OGG, FLAC, WebM). */
export const AUDIO_MIME = /^audio\/(mpeg|mp3|wav|x-wav|mp4|x-m4a|aac|ogg|flac|webm)$/;

export async function uploadFiles(files: File[]): Promise<string[]> {
  const st = get();
  const sessionId = st.activeSessionId;
  const out: Asset[] = [];
  for (const f of files) {
    const is3d = /\.glb$/i.test(f.name);
    if (!is3d && !AUDIO_MIME.test(f.type) && !/^image\/(png|jpeg|webp|gif)$|^video\/(mp4|webm|quicktime)$/.test(f.type)) {
      toast(`${f.name}: unsupported file type`, 'error');
      continue;
    }
    if (f.size > 60 * 1024 * 1024) {
      toast(`${f.name}: file is larger than 60 MB`, 'error');
      continue;
    }
    try {
      if (is3d) await validateGlb(f);
      const info = is3d ? { width: 0, height: 0, duration: undefined } : await probeMedia(f);
      const id = uid('ast');
      await putAssetBlob(id, is3d ? new Blob([f], { type: GLB_MIME }) : f);
      out.push({
        id,
        kind: is3d ? 'model3d' : f.type.startsWith('video/') ? 'video' : f.type.startsWith('audio/') ? 'audio' : 'image',
        mime: is3d ? GLB_MIME : f.type,
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
  // A GLB is imported to the gallery (open it there); no model takes a 3D file as input.
  const models = ids.filter((id) => get().assets[id]?.kind === 'model3d');
  if (models.length) toast(`${models.length} 3D model${models.length > 1 ? 's' : ''} added to the gallery.`, 'info');
  const inputs = ids.filter((id) => !models.includes(id));
  if (inputs.length) setComposer((c) => ({ attachments: [...c.attachments, ...inputs] }));
}

// ---------------------------------------------------------------------------
// Operations on assets and layers

export async function opEstimate(assetId: string, op: OpId, params: Record<string, AdvancedValue>): Promise<{ estimate: Estimate; modelName: string; viaNote?: string }> {
  const spec = await opSpec({ sessionId: get().activeSessionId, sourceAssetId: assetId, op, params, origin: 'op' });
  const ref = spec.modelRef;
  const name = ref === 'local::frame' ? 'Local, free' : modelSummary(ref)?.name ?? get().catalog.transcribers?.[ref]?.name ?? (ref.startsWith('local::') ? 'Local demo' : ref);
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
  if (kind === 'image') return { accepts: Boolean(schema?.slots.images), max: (schema?.slots.images?.max ?? 0) + (schema?.slots.source ? 1 : 0) };
  const slots = schema?.slots ?? {};
  const refs = slots.mixedRefs?.max ?? slots.images?.max ?? 0;
  return { accepts: Boolean(slots.firstFrame || refs), max: (slots.firstFrame ? 1 : 0) + refs };
}

export function hasParam(kind: MediaKind, role: Parameters<typeof paramByRole>[1]): boolean {
  const st = get();
  return Boolean(paramByRole(st.catalog.schemas[st.composer[kind].modelRef], role));
}
