import { getAssetBlob } from '../../lib/idb';
import { blobToDataUrl, canvasToBlob, createCanvas, ctx2d, extractVideoFrame, fetchBlob, blobToCanvas } from '../../lib/media';
import type { LlmContentPart, LlmMessage } from '../types';
import { useStore } from '../../store/store';

/*
 * What the agent sees of the user's attachments: the images themselves (and a video's first frame), reduced,
 * each labeled with its asset id so plans can cite it. They travel only while the request that brought them is
 * open (questions, plan, revisions); a new request swaps them for a one-line note, so they are not re-sent
 * with every message nor kept in the saved state.
 */

/** Longest side sent to the model: enough to read subject, style and framing, cheap in tokens. */
export const VISION_MAX_SIDE = 768;

/** Whether the selected agent model takes images. Unknown counts as yes (Settings already prefers vision models). */
export function agentSeesImages(): boolean {
  const { settings, catalog } = useStore.getState();
  const provider = settings.agent.provider;
  if (provider === 'offline') return false;
  const model = catalog.llm[provider]?.find((m) => m.id === settings.agent.model);
  return model?.vision !== false;
}

async function reducedDataUrl(blob: Blob): Promise<string> {
  const src = await blobToCanvas(blob);
  const k = Math.min(1, VISION_MAX_SIDE / Math.max(src.width, src.height));
  const c = createCanvas(src.width * k, src.height * k);
  ctx2d(c).drawImage(src, 0, 0, c.width, c.height);
  return blobToDataUrl(await canvasToBlob(c, 'image/jpeg', 0.82));
}

async function assetBlob(id: string): Promise<Blob | undefined> {
  const a = useStore.getState().assets[id];
  return (await getAssetBlob(id)) ?? (a?.remoteUrl ? await fetchBlob(a.remoteUrl).catch(() => undefined) : undefined);
}

/** Image parts for the attached images and videos (first frame); audio and 3D stay as text in the context. */
export async function attachmentParts(ids: string[], deps: { dataUrl?: (id: string) => Promise<string | null> } = {}): Promise<LlmContentPart[]> {
  const assets = useStore.getState().assets;
  const parts: LlmContentPart[] = [];
  for (const id of ids) {
    const a = assets[id];
    if (!a || (a.kind !== 'image' && a.kind !== 'video')) continue;
    let url: string | null = null;
    try {
      if (deps.dataUrl) url = await deps.dataUrl(id);
      else {
        const blob = await assetBlob(id);
        if (blob && a.kind === 'image') url = await reducedDataUrl(blob);
        else if (blob) {
          const src = URL.createObjectURL(blob);
          try {
            url = await reducedDataUrl((await extractVideoFrame(src, 'first')).blob);
          } finally {
            URL.revokeObjectURL(src);
          }
        }
      }
    } catch {
      url = null;
    }
    const label = `asset:${id} (${a.kind === 'video' ? `video ${a.width}×${a.height}${a.duration ? ` ${a.duration.toFixed(1)}s` : ''}, first frame shown` : `image ${a.width}×${a.height}`})`;
    parts.push({ type: 'text', text: url ? `${label}:` : `${label}: could not be shown.` });
    if (url) parts.push({ type: 'image_url', image_url: { url } });
  }
  return parts;
}

/** A user message with its text first and the attachment images after it; plain text when there are none. */
export function userMessage(text: string, parts: LlmContentPart[]): LlmMessage {
  return { role: 'user', content: parts.some((p) => p.type === 'image_url') ? [{ type: 'text', text }, ...parts] : text };
}

/** History with earlier images replaced by a note: sent once per request, not on every later message. */
export function stripImages(history: LlmMessage[]): LlmMessage[] {
  return history.map((m) => {
    if (!Array.isArray(m.content)) return m;
    const text = m.content
      .map((p) => (p.type === 'text' ? p.text : '[image shown earlier]'))
      .join('\n');
    return { ...m, content: text };
  });
}
