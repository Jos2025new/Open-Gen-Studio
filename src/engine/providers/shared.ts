import { blobToDataUrl, base64ToBlob, guessMimeFromUrl, prepareImageForUpload } from '../../lib/media';
import type { ImageInputFormat, MediaKind } from '../types';
import type { GenOutput, MediaInput } from './types';

/** Encode an input image for a JSON body (data URL, or an OpenAI-style content part). */
export async function encodeImage(input: MediaInput, format: ImageInputFormat, upload?: (blob: Blob) => Promise<string>): Promise<unknown> {
  const prepared = await prepareImageForUpload(input.blob);
  if (format === 'url' && upload) return upload(prepared);
  const dataUrl = await blobToDataUrl(prepared);
  if (format === 'content-part') return { type: 'image_url', image_url: { url: dataUrl } };
  return dataUrl;
}

/** Encode a source video: an uploaded URL when the provider needs one, else a data URL (no re-encoding). */
export async function encodeVideo(input: MediaInput, upload?: (blob: Blob) => Promise<string>): Promise<string> {
  return upload ? upload(input.blob) : blobToDataUrl(input.blob);
}

/** Find media outputs in the many response shapes providers use. */
export function extractOutputs(json: unknown, kind: MediaKind): GenOutput[] {
  const out: GenOutput[] = [];
  const seen = new Set<string>();
  const push = (o: GenOutput) => {
    const key = o.url ?? (o.blob ? `blob:${o.blob.size}:${out.length}` : '');
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(o);
  };
  const visitFile = (f: unknown) => {
    if (!f) return;
    if (typeof f === 'string') {
      if (/^https?:\/\//.test(f)) push({ url: f, mime: guessMimeFromUrl(f, kind) });
      else if (f.startsWith('data:')) push({ blob: base64ToBlob(f, f.slice(5, f.indexOf(';')) || 'image/png') });
      return;
    }
    if (typeof f !== 'object') return;
    const o = f as Record<string, unknown>;
    if (typeof o.b64_json === 'string') {
      const mime = typeof o.media_type === 'string' ? o.media_type : typeof o.content_type === 'string' ? o.content_type : 'image/png';
      push({ blob: base64ToBlob(o.b64_json, mime), mime });
      return;
    }
    const url = (o.url ?? o.image_url ?? o.video_url ?? o.uri) as unknown;
    if (typeof url === 'string') {
      const mime = typeof o.content_type === 'string' ? o.content_type : undefined;
      if (url.startsWith('data:')) push({ blob: base64ToBlob(url, url.slice(5, url.indexOf(';')) || mime || 'image/png') });
      else push({ url, mime: mime ?? guessMimeFromUrl(url, kind) });
    } else if (url && typeof url === 'object') {
      visitFile(url);
    }
  };
  const root = (json ?? {}) as Record<string, unknown>;
  const data = (root.data && typeof root.data === 'object' ? root.data : {}) as Record<string, unknown>;
  const candidates: unknown[] = [
    root.images,
    root.image,
    root.video,
    root.videos,
    root.outputs,
    root.output,
    Array.isArray(root.data) ? root.data : undefined,
    data.outputs,
    data.output,
    (data.output as Record<string, unknown> | undefined)?.video,
    (data.output as Record<string, unknown> | undefined)?.images,
    data.videoUrl,
    data.video_url,
    root.videoUrl,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) c.forEach(visitFile);
    else visitFile(c);
  }
  return out;
}

export function numberOrUndefined(v: unknown): number | undefined {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

export function authBearer(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}` };
}

export const JSON_HEADERS = { 'Content-Type': 'application/json' };
