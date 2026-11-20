/* Reading asset bytes for a send and storing what the provider returned (moved out of jobs.ts, Opus #4). */
import { notKept } from './keepResult';
import { uid } from '../lib/id';
import { JobFailedError } from '../lib/http';
import { getAssetBlob, putAssetBlob } from '../lib/idb';
import { extractVideoFrame, jpegThumbnail, fetchBlob, probeMedia, type MediaInfo } from '../lib/media';
import { modelMime, sniffModelMime } from '../lib/model3d';
import { dimsFor, longEdgeFor, ratioOf } from './params';
import { type GenOutput, type MediaInput } from './providers/types';
import type { Asset, GenSettings, Generation, MediaKind } from './types';
import { patchAsset, useStore } from '../store/store';

const get = useStore.getState;

/** An asset's bytes; a result still only at the provider is downloaded and kept (links expire). */
export async function ensureAssetBlob(assetId: string): Promise<Blob> {
  const asset = get().assets[assetId];
  if (!asset) throw new Error('An input asset was deleted.');
  const stored = await getAssetBlob(assetId);
  if (stored) {
    // Bytes saved by an earlier attempt whose flag never landed: show the local copy, not the remote link.
    if (!asset.stored) patchAsset(assetId, { stored: true, remoteUrl: undefined });
    return stored;
  }
  if (!asset.remoteUrl) throw new Error('An input asset is not available offline.');
  const blob = await fetchBlob(asset.remoteUrl);
  await putAssetBlob(assetId, blob);
  patchAsset(assetId, { stored: true, remoteUrl: undefined });
  return blob;
}

/** Keep results that are still only at the provider (e.g. after a download was blocked). Best effort. */
export async function adoptRemoteAssets(): Promise<void> {
  for (const a of Object.values(get().assets)) {
    if (!a.stored && a.remoteUrl) await ensureAssetBlob(a.id).catch(notKept('keep a remote result'));
  }
}

export async function mediaInput(assetId: string): Promise<MediaInput> {
  const asset = get().assets[assetId];
  const blob = await ensureAssetBlob(assetId);
  return { assetId, blob, mime: blob.type || asset.mime, width: asset.width, height: asset.height };
}

export async function frameInput(assetId: string, which: 'first' | 'last' | number): Promise<MediaInput> {
  // Read frames from local bytes: a remote video without CORS cannot be drawn to a canvas.
  const url = URL.createObjectURL(await ensureAssetBlob(assetId));
  try {
    const f = await extractVideoFrame(url, which);
    return { assetId, blob: f.blob, mime: 'image/png', width: f.width, height: f.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function storeOutput(o: GenOutput, g: Generation, kind: MediaKind, fallback: MediaInfo, thumbnailUrl?: string): Promise<Asset> {
  const id = uid('ast');
  let blob = o.blob;
  if (!blob && o.url) {
    try {
      blob = await fetchBlob(o.url);
    } catch (err) {
      notKept('download result')(err); // keep the remote URL
    }
  }
  let info: MediaInfo = fallback;
  if (blob) {
    await putAssetBlob(id, blob);
    // A 3D file is never decoded here: probing would load the mesh into an image/video element.
    if (kind !== 'model3d') info = await probeMedia(blob).catch(() => fallback);
  }
  return {
    id,
    kind,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    mime: blob?.type || o.mime || (kind === 'image' ? 'image/png' : kind === 'audio' ? 'audio/mpeg' : kind === 'model3d' ? 'model/gltf-binary' : 'video/mp4'),
    width: info.width || fallback.width,
    height: info.height || fallback.height,
    duration: info.duration ?? fallback.duration,
    sessionId: g.sessionId,
    generationId: g.id,
    origin: 'generated',
    place: g.place,
    mode: g.mode,
    remoteUrl: blob ? undefined : o.url,
    stored: Boolean(blob),
    favorite: false,
    createdAt: Date.now(),
  };
}

/** A 3D result is model files plus often a render: each model is an asset, the render their thumbnail. */
export async function storeModelOutputs(outputs: GenOutput[], g: Generation): Promise<Asset[]> {
  const files = await Promise.all(
    outputs.map(async (o) => {
      let blob = o.blob;
      if (!blob && o.url) blob = await fetchBlob(o.url).catch(notKept('download result'));
      const mime = blob ? await sniffModelMime(blob, o.mime) : (o.mime ?? modelMime(o.url ?? '') ?? 'application/octet-stream');
      return { o, blob: blob && blob.type !== mime ? new Blob([blob], { type: mime }) : blob, mime };
    }),
  );
  const isImage = (f: { mime: string }) => f.mime.startsWith('image/');
  // A turntable/preview clip is not the model either; it is dropped.
  const models = files.filter((f) => !isImage(f) && !f.mime.startsWith('video/'));
  if (!models.length) throw new JobFailedError('The provider finished without a 3D file (only a preview image).');
  const thumb = files.find(isImage);
  const thumbnailUrl = thumb?.blob ? await jpegThumbnail(thumb.blob).catch(() => undefined) : undefined;
  return Promise.all(models.map((f) => storeOutput({ blob: f.blob, url: f.o.url, mime: f.mime }, g, 'model3d', { width: 0, height: 0 }, thumbnailUrl)));
}

export function expectedDims(kind: MediaKind, s: GenSettings): MediaInfo {
  if (kind === 'audio' || kind === 'model3d') return { width: 0, height: 0 };
  const ratio = ratioOf(s.aspect) ?? (kind === 'video' ? 16 / 9 : 1);
  return { ...dimsFor(ratio, longEdgeFor(s.resolution ?? s.aspect)), duration: kind === 'video' && s.duration != null && s.duration > 0 ? s.duration : undefined };
}
