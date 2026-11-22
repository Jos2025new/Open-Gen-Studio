import { assetsInUse } from './flow/locks';
import { dropResults } from './flow/dropResults';
import { GLB_MIME, validateGlb } from '../lib/model3d';
import { uid } from '../lib/id';
import { deleteAssetBlobs, putAssetBlob } from '../lib/idb';
import { probeMedia } from '../lib/media';
import { runsGeneration } from './flow/graph';
import { placeFor } from './place';
import type { Asset, GraphNode } from './types';
import { addAssets, setComposer, setUi, toast, useStore } from '../store/store';
import { editCompound } from './nodecore/edit';
import { clearGenerationPass } from './budget';

const get = useStore.getState;

export function deleteGeneration(generationId: string): void {
  clearGenerationPass(generationId, true);
  const g = get().generations[generationId];
  if (!g) return;
  const assetIds = [...g.assetIds];
  if (assetsInUse(assetIds)) { toast('A result is in use by a running flow.', 'error'); return; }
  useStore.setState((st) => {
    const { generations, sessions: moved } = dropResults(st, new Set(assetIds));
    delete generations[generationId];
    const assets = { ...st.assets };
    for (const id of assetIds) delete assets[id];
    const s = moved[g.sessionId];
    const sessions = s ? { ...moved, [g.sessionId]: { ...s, feed: s.feed.filter((f) => !(f.type === 'generation' && f.generationId === generationId)) } } : moved;
    return { generations, assets, sessions, composer: { ...st.composer, attachments: st.composer.attachments.filter((a) => !assetIds.includes(a)) } };
  });
  if (g.sessionId in get().sessions) editCompound(g.sessionId, 'delete generation', (gr) => ({ ...gr, nodes: gr.nodes.map((n) => runsGeneration(n.data) && n.data.generationId === generationId ? { ...n, data: { ...n.data, generationId: undefined } as GraphNode['data'] } : n) }), { silent: true });
  void deleteAssetBlobs(assetIds);
}

export function deleteAssets(ids: string[]): void {
  if (!ids.length) return;
  if (assetsInUse(ids)) { toast('An asset is in use by a running flow. Wait for it to finish.', 'error'); return; }
  const set = new Set(ids);
  useStore.setState((st) => {
    const assets = { ...st.assets };
    ids.forEach((id) => delete assets[id]);
    const { generations, sessions } = dropResults(st, set);
    return { assets, generations, sessions, composer: { ...st.composer, attachments: st.composer.attachments.filter((a) => !set.has(a)) } };
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

export function addAsReference(assetId: string): void {
  const st = get();
  const a = st.assets[assetId];
  if (!a) return;
  // A 3D model goes in as its view image.
  const id = a.kind === 'model3d' ? a.viewImageId : assetId;
  if (!id || !st.assets[id]) {
    toast('This 3D model has no view image yet. Open it once, then try again.', 'error');
    return;
  }
  setComposer((c) => ({ attachments: c.attachments.includes(id) ? c.attachments : [...c.attachments, id] }));
  setUi((u) => ({ focusComposer: u.focusComposer + 1, lightbox: null }));
}

/** Attachment policy for the agent's context, independent of the media generation kinds. */
export const AGENT_ATTACHABLE: readonly string[] = ['image', 'video', 'audio', 'model3d'];

/** Toggle an existing asset in the agent's attachment list. No asset is created or copied. */
export function toggleAgentAttachment(assetId: string): void {
  const asset = get().assets[assetId];
  if (!asset || !AGENT_ATTACHABLE.includes(asset.kind)) return;
  setComposer((c) => ({
    attachments: c.attachments.includes(assetId)
      ? c.attachments.filter((id) => id !== assetId)
      : [...c.attachments, assetId],
  }));
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
        place: placeFor(st.ui, st.ui.workspace),
        mode: is3d ? 'model3d' : f.type.startsWith('video/') ? 'video' : f.type.startsWith('audio/') ? 'audio' : 'image',
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
  if (inputs.length) {
    setComposer((c) => ({ attachments: [...c.attachments, ...inputs] }));
    if (get().ui.workspace === 'designer') setUi({ designerDock: 'prompt' });
  }
}
