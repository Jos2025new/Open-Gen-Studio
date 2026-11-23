import { cacheDb } from '../../lib/cacheDb';
import { blobToDataUrl, base64ToBlob, guessMimeFromUrl, prepareImageForUpload } from '../../lib/media';
import type { ImageInputFormat, InputSlots, MediaKind } from '../types';
import { HttpError, isAbort, isTransient, JobFailedError, sleep } from '../../lib/http';
import type { GenOutput, GenResult, MediaInput, ResumeContext } from './types';

/**
 * The one place providers read and write the IndexedDB cache (Opus #10): the value saved under `key` while it is
 * younger than `ttlMs`; otherwise `load()` runs and its answer is saved. An `undefined` answer (a failed or
 * partial load) is returned but not saved, so the next call asks again. Keys and TTLs belong to the caller.
 */
export async function cachedJson<T>(key: string, ttlMs: number, load: () => Promise<T | undefined>): Promise<T | undefined> {
  const cached = await cacheDb.get<T>(key, ttlMs);
  if (cached) return cached;
  const fresh = await load();
  if (fresh !== undefined) await cacheDb.set(key, fresh);
  return fresh;
}

/** The saved value only, never the network (listings that must stay instant). */
export function peekCached<T>(key: string, ttlMs: number): Promise<T | undefined> {
  return cacheDb.get<T>(key, ttlMs);
}

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

/** Resolve any nested Promises inside a prepared request body before serialization. */
export async function resolveBody<T>(v: T): Promise<T> {
  if (v instanceof Promise) return resolveBody(await v);
  if (Array.isArray(v)) return Promise.all(v.map(resolveBody)) as Promise<T>;
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(await Promise.all(Object.entries(v).map(async ([k, x]) => [k, await resolveBody(x)] as const))) as T;
  }
  return v;
}

/**
 * Keyframe and trimmed-clip lists (FLUX 3 `keyframes`, `video_clips`) and audio inputs, built from the slot's
 * field names. `image`/`video` encode one input (sync token in dry-run, Promise of URL/data URL when sending).
 */
export function structuredInputs(
  slots: InputSlots,
  req: {
    keyframes?: Array<{ input: MediaInput; frame: number }>;
    clips?: Array<{ input: MediaInput; start: number; end: number }>;
    audio?: MediaInput;
    refAudios?: MediaInput[];
    elements?: Array<{ name: string; description?: string; frontal?: MediaInput; refs: MediaInput[]; video?: MediaInput; voiceId?: string }>;
    mask?: MediaInput;
  },
  image: (m: MediaInput) => unknown,
  video: (m: MediaInput) => unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (slots.mask && req.mask) out[slots.mask.key] = image(req.mask);
  const el = slots.elements;
  if (el && req.elements?.length) {
    out[el.key] = req.elements.slice(0, el.max).map((e) => {
      const frontal = e.frontal ? image(e.frontal) : undefined;
      const refs = e.refs.slice(0, el.refMax).map(image);
      const clip = el.video && e.video ? video(e.video) : undefined;
      if (el.style === 'atlas') {
        return clip && !frontal
          ? { element_name: e.name, ...(e.description ? { element_description: e.description } : {}), reference_type: 'video_refer', refer_videos: [clip] }
          : { element_name: e.name, ...(e.description ? { element_description: e.description } : {}), reference_type: 'image_refer', frontal_image: frontal, refer_images: refs.length ? refs : [frontal] };
      }
      return { ...(frontal ? { frontal_image_url: frontal } : {}), ...(refs.length ? { reference_image_urls: refs } : {}), ...(clip ? { video_url: clip } : {}), ...(el.voice && e.voiceId ? { voice_id: e.voiceId } : {}) };
    });
  }
  if (slots.audio && req.audio) out[slots.audio.key] = video(req.audio);
  if (slots.refAudios && req.refAudios?.length) out[slots.refAudios.key] = req.refAudios.slice(0, slots.refAudios.max).map(video);
  const kf = slots.keyframes;
  if (kf && req.keyframes?.length) out[kf.key] = req.keyframes.slice(0, kf.max).map((k) => ({ [kf.imageKey]: image(k.input), [kf.indexKey]: k.frame }));
  const cl = slots.clips;
  if (cl && req.clips?.length) out[cl.key] = req.clips.slice(0, cl.max).map((c) => ({ url: video(c.input), start: c.start, ends: c.end, ...(cl.fps ? { [cl.fps.key]: cl.fps.value } : {}) }));
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
/** The provider's own words when a response body reports the job as failed (top level or under data); else undefined. */
export function failedJobMessage(body: unknown): string | undefined {
  const levels = [body, (body as { data?: unknown } | null)?.data].filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object');
  for (const b of levels) {
    const status = String(b.status ?? '').toLowerCase();
    if (['failed', 'failure', 'error', 'canceled', 'cancelled'].includes(status)) {
      const why = b.error ?? b.message ?? (body as { message?: unknown }).message;
      const text = typeof why === 'string' && why.trim() ? why.trim() : 'the job failed';
      // The provider's own error code, when it gives one, travels with the message (for the log).
      const code = b.error_code ?? (body as { error_code?: unknown }).error_code;
      return code != null && code !== '' ? `${text} [code ${String(code)}]` : text;
    }
  }
  return undefined;
}

/** Waits of the running polls; "Check status" ends them so every job is asked about now (and backoff restarts). */
const pollWaits = new Set<() => void>();
export function checkJobsNow(): void {
  for (const wake of [...pollWaits]) wake();
}

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
      // An error status whose body says the job failed (Atlas: HTTP 511 with status "failed") is final, not a retry.
      const failed = err instanceof HttpError ? failedJobMessage(err.body) : undefined;
      if (failed) throw new JobFailedError(`${provider}: ${failed}`);
      // A rejected key stays final (retrying cannot fix it). Aborts (Stop, Check status restart) end the wait. Any other
      // failure to ask about the job keeps it followed: the card says so and the question goes out again, instead of
      // marking a job that may still finish as failed.
      const rejectedKey = err instanceof HttpError && (err.status === 401 || err.status === 403);
      if (err instanceof JobFailedError || rejectedKey || ctx.signal.aborted || isAbort(err)) throw err;
      failures++;
      wait = Math.min(60_000, intervalMs * 2 ** failures);
      const why = isTransient(err) ? 'Connection problem' : `Could not check the job (${(err as Error).message.slice(0, 120)})`;
      ctx.onStatus(`${why} · retrying in ${Math.round(wait / 1000)}s`);
    }
    if (Date.now() - started + wait > maxWaitMs) {
      throw new Error(`Stopped waiting after ${maxWaitMs / 60_000} min; the job may still finish at ${provider}. Use Check again later.`);
    }
    // A wait "Check status" can end early: the next question to the provider goes out now.
    let woke = false;
    await new Promise<void>((resolve, reject) => {
      const wake = () => { woke = true; resolve(); };
      pollWaits.add(wake);
      sleep(wait, ctx.signal).then(resolve, reject).finally(() => pollWaits.delete(wake));
    });
    if (woke) failures = 0;
  }
}

/**
 * A URL the provider (or the saved job) gave us, checked before the API key is attached to it: https and on the
 * provider's own origin. A job record changed on disk or a provider answer pointing elsewhere never receives the key.
 */
export function keyedUrl(url: string, origin: string, provider: string): string {
  let ok = false;
  try {
    const u = new URL(url);
    ok = u.protocol === 'https:' && u.origin === origin;
  } catch {
    ok = false;
  }
  if (!ok) throw new JobFailedError(`${provider}: the job points to an unexpected address (${url.slice(0, 80)}); the API key was not sent.`);
  return url;
}
