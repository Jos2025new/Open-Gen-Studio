import { currentViewImage, viewReferenceLabel } from './assetSearch';
import { getAssetBlob } from '../../lib/idb';
import { blobToDataUrl, canvasToBlob, createCanvas, ctx2d, fetchBlob, blobToCanvas, videoFrameSheet } from '../../lib/media';
import type { Asset, LlmContentPart, LlmMessage } from '../types';
import { useStore } from '../../store/store';

/*
 * What the agent sees of the user's attachments: the images themselves (and four moments of a video on one sheet), reduced,
 * each labeled with its asset id so plans can cite it. They travel only while the request that brought them is
 * open (questions, plan, revisions); a new request swaps them for a one-line note, so they are not re-sent
 * with every message nor kept in the saved state.
 */

/** Longest side sent to the model: enough to read subject, style and framing, cheap in tokens. */
export const VISION_MAX_SIDE = 768;

/** Stable, human-readable metadata for an attachment; quoted by callers before it enters model context. */
export function assetContextName(asset: Pick<Asset, 'id' | 'kind' | 'name'>): string {
  return asset.name?.trim() || `${asset.kind}-${asset.id.slice(-8)}`;
}

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

/** Image parts for the attached images, videos (a 2×2 sheet of four moments) and 3D models (the view image the app renders
 *  from the viewer, the angle the user left it at); audio stays as text in the context. */
export async function attachmentParts(ids: string[], deps: { dataUrl?: (id: string) => Promise<string | null> } = {}): Promise<LlmContentPart[]> {
  const assets = useStore.getState().assets;
  const parts: LlmContentPart[] = [];
  for (const id of ids) {
    const a = assets[id];
    if (!a || (a.kind !== 'image' && a.kind !== 'video' && a.kind !== 'model3d')) continue;
    let url: string | null = null;
    try {
      if (a.kind === 'model3d') {
        // Its view image: rendered when the user moves the model in the viewer (or on first show).
        const view = currentViewImage(a, assets)?.id;
        if (view && deps.dataUrl) url = await deps.dataUrl(view);
        else if (view) { const blob = await assetBlob(view); if (blob) url = await reducedDataUrl(blob); }
        if (!url && a.thumbnailUrl?.startsWith('data:')) url = a.thumbnailUrl;
      } else if (deps.dataUrl) url = await deps.dataUrl(id);
      else {
        const blob = await assetBlob(id);
        if (blob && a.kind === 'image') url = await reducedDataUrl(blob);
        else if (blob) {
          const src = URL.createObjectURL(blob);
          try {
            url = await blobToDataUrl((await videoFrameSheet(src, VISION_MAX_SIDE)).blob);
          } finally {
            URL.revokeObjectURL(src);
          }
        }
      }
    } catch {
      url = null;
    }
    const label = a.kind === 'model3d'
      ? `asset:${id} name=${JSON.stringify(assetContextName(a))} (3D model, ${viewReferenceLabel(a, assets)}; shown by the viewer capture, not the GLB file)`
      : `asset:${id} name=${JSON.stringify(assetContextName(a))} (${a.kind === 'video' ? `video ${a.width}×${a.height}${a.duration ? ` ${a.duration.toFixed(1)}s` : ''}, 4 frames shown on one 2×2 sheet: start, ⅓, ⅔, end` : `image ${a.width}×${a.height}`})`;
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

/**
 * Tools whose answer is a reference the agent can ask for again (T6): a guide, the model list, the library. Their
 * results travelled with every later message of the conversation (a follow-up reached 155k input tokens), so at the
 * start of a new request each one becomes a line saying what it was. Nothing is lost: the call and its result stay
 * in the history (repairHistory still pairs them) and any of them can be read again.
 */
const REFERENCE_TOOLS: Record<string, string> = {
  read_guide: 'guide',
  find_models: 'model list',
  find_assets: 'library',
};

/**
 * Only when the reference text is worth trading for. Measured with the automatic twin (e2e/REFERENCE_RUNS.md,
 * 2026-10-03): in a normal conversation those results are ~12k of ~80k characters of prompt, so trimming them saved
 * ~13 % of what each call sends but invalidated the provider's cache prefix on every request, and the two models
 * spent *more* (DeepSeek $0.057 → $0.075, GPT 6 Luna $0.018 → $0.023). Past this size the prompt they travel in
 * costs more than the cache prefix they cost, which is the case the change exists for (~10k tokens of guides read
 * in one conversation, and far more in a long one).
 */
export const TRIM_MIN_CHARS = 40_000;

/** One line in place of a reference tool's result: what it was about (from the call, never from the result). */
export function trimmedResult(tool: string, args: string | undefined): string | undefined {
  const what = REFERENCE_TOOLS[tool];
  if (!what) return undefined;
  let about = '';
  try {
    const a = JSON.parse(args ?? '{}') as Record<string, unknown>;
    const said = [a.id, a.query, a.kind, a.subject].find((v) => typeof v === 'string' && v) as string | undefined;
    if (said) about = ` ${said}`;
  } catch {
    // Arguments that are not JSON: the line says what it is and nothing more.
  }
  return `[${what}${about} loaded earlier; ${tool} again if you need it]`;
}

/** History with the results of earlier reference tools replaced by a line, once they are big enough to be worth it. */
export function trimReferenceResults(history: LlmMessage[], minChars = TRIM_MIN_CHARS): LlmMessage[] {
  // Which tool each call id belongs to, and what it asked for.
  const asked = new Map<string, { tool: string; args?: string }>();
  for (const m of history) for (const c of m.tool_calls ?? []) asked.set(c.id, { tool: c.function.name, args: c.function.arguments });
  const isRef = (m: LlmMessage) => m.role === 'tool' && !!m.tool_call_id && REFERENCE_TOOLS[asked.get(m.tool_call_id!)?.tool ?? ''] != null;
  const chars = history.reduce((a, m) => a + (isRef(m) && typeof m.content === 'string' ? m.content.length : 0), 0);
  if (chars < minChars) return history;
  return history.map((m) => {
    if (!isRef(m)) return m;
    const call = asked.get(m.tool_call_id!)!;
    const note = trimmedResult(call.tool, call.args);
    return note ? { ...m, content: note } : m;
  });
}
