import { blobToDataUrl, base64ToBlob, guessMimeFromUrl, prepareImageForUpload } from '../../lib/media';
import type { ImageInputFormat, InputSlots, MediaKind } from '../types';
import { isTransient, sleep } from '../../lib/http';
import type { GenOutput, GenResult, MediaInput, ResumeContext } from './types';

/** Encode an input image for a JSON body (data URL, or an OpenAI-style content part). */
export async function encodeImage(input: MediaInput, format: ImageInputFormat, upload?: (blob: Blob) => Promise<string>): Promise<unknown> {
  const prepared = await prepareImageForUpload(input.blob);
  if (format === 'url' && upload) return upload(prepared);
  const dataUrl = await blobToDataUrl(prepared);
  if (format === 'content-part') return { type: 'image_url', image_url: { url: dataUrl } };
  return dataUrl;
}

/** Image models with a `source` slot take the first input image there and the rest as references. */
export function splitSource(slots: InputSlots, refs: MediaInput[]): { source?: MediaInput; refs: MediaInput[] } {
  return slots.source && refs.length ? { source: refs[0], refs: refs.slice(1) } : { refs };
}

/**
 * Keyframe and trimmed-clip lists (FLUX 3 `keyframes`, `video_clips`) and audio inputs, built from the slot's
 * field names. `image`/`video` encode one input the way the provider takes files (uploaded URL or data URL);
 * `video` also encodes audio (both are sent as files, untouched).
 */
export async function structuredInputs(
  slots: InputSlots,
  req: {
    keyframes?: Array<{ input: MediaInput; frame: number }>;
    clips?: Array<{ input: MediaInput; start: number; end: number }>;
    audio?: MediaInput;
    refAudios?: MediaInput[];
    elements?: Array<{ name: string; description?: string; frontal?: MediaInput; refs: MediaInput[]; video?: MediaInput; voiceId?: string }>;
    mask?: MediaInput;
  },
  image: (m: MediaInput) => Promise<unknown>,
  video: (m: MediaInput) => Promise<string>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  if (slots.mask && req.mask) out[slots.mask.key] = await image(req.mask);
  const el = slots.elements;
  if (el && req.elements?.length) {
    out[el.key] = await Promise.all(
      req.elements.slice(0, el.max).map(async (e) => {
        const frontal = e.frontal ? await image(e.frontal) : undefined;
        const refs = await Promise.all(e.refs.slice(0, el.refMax).map(image));
        const clip = el.video && e.video ? await video(e.video) : undefined;
        if (el.style === 'atlas') {
          // Atlas creates the element inline: an image set needs at least one extra view, the frontal image serves.
          return clip && !frontal
            ? { element_name: e.name, ...(e.description ? { element_description: e.description } : {}), reference_type: 'video_refer', refer_videos: [clip] }
            : { element_name: e.name, ...(e.description ? { element_description: e.description } : {}), reference_type: 'image_refer', frontal_image: frontal, refer_images: refs.length ? refs : [frontal] };
        }
        return { ...(frontal ? { frontal_image_url: frontal } : {}), ...(refs.length ? { reference_image_urls: refs } : {}), ...(clip ? { video_url: clip } : {}), ...(el.voice && e.voiceId ? { voice_id: e.voiceId } : {}) };
      }),
    );
  }
  if (slots.audio && req.audio) out[slots.audio.key] = await video(req.audio);
  if (slots.refAudios && req.refAudios?.length) out[slots.refAudios.key] = await Promise.all(req.refAudios.slice(0, slots.refAudios.max).map(video));
  const kf = slots.keyframes;
  if (kf && req.keyframes?.length) {
    out[kf.key] = await Promise.all(req.keyframes.slice(0, kf.max).map(async (k) => ({ [kf.imageKey]: await image(k.input), [kf.indexKey]: k.frame })));
  }
  const cl = slots.clips;
  if (cl && req.clips?.length) {
    out[cl.key] = await Promise.all(
      req.clips.slice(0, cl.max).map(async (c) => ({ url: await video(c.input), start: c.start, ends: c.end, ...(cl.fps ? { [cl.fps.key]: cl.fps.value } : {}) })),
    );
  }
  return out;
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
    const url = (o.url ?? o.image_url ?? o.video_url ?? o.model_url ?? o.modelUrl ?? o.glb_url ?? o.uri) as unknown;
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
    // 3D results: model file fields (the bytes decide the final type).
    ...(kind === 'model3d'
      ? [root.files, data.files, root.model, data.model_url, data.modelUrl, root.model_url, (data.output as Record<string, unknown> | undefined)?.model, data.thumbnail]
      : []),
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

/** Per-request limit for status checks: a hung request must not stall the wait loop. */
export const POLL_TIMEOUT_MS = 30_000;

/**
 * Wait for a remote job. `check` returns the result, or a status label while it is still running.
 * A failed check (offline, timeout, 408/429/5xx) is retried with a growing pause: it says nothing about the job.
 * Only `check` decides that the job failed (by throwing JobFailedError). Past the local time limit the wait
 * stops with a plain error, and the caller keeps the job so it can be checked again later.
 */
export async function pollJob(ctx: ResumeContext, provider: string, intervalMs: number, check: () => Promise<GenResult | string>): Promise<GenResult> {
  const started = Date.now();
  const maxWaitMs = (ctx.kind === 'image' ? 10 : 30) * 60_000;
  let failures = 0;
  for (;;) {
    let wait = intervalMs;
    try {
      const r = await check();
      if (typeof r !== 'string') return r;
      failures = 0;
      ctx.onStatus(`${r} · ${Math.round((Date.now() - started) / 1000)}s`);
    } catch (err) {
      if (!isTransient(err)) throw err;
      failures++;
      wait = Math.min(60_000, intervalMs * 2 ** failures);
      ctx.onStatus(`Connection problem · retrying in ${Math.round(wait / 1000)}s`);
    }
    if (Date.now() - started + wait > maxWaitMs) {
      throw new Error(`Stopped waiting after ${maxWaitMs / 60_000} min; the job may still finish at ${provider}. Use Check again later.`);
    }
    await sleep(wait, ctx.signal);
  }
}
