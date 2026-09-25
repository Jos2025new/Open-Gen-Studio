import { cacheDb } from '../../lib/idb';
import { extractErrorMessage, JobFailedError, requestJson } from '../../lib/http';
import { fetchBlob } from '../../lib/media';
import { humanizeKey, ratioOf, roleForKey, wireParams, isHiddenKey } from '../params';
import type { ModelSchema, ModelSummary, ParamDef, PriceRule, PriceSku, RemoteJob } from '../types';
import { encodeImage, encodeVideo, extractOutputs, JSON_HEADERS, numberOrUndefined, POLL_TIMEOUT_MS, pollJob } from './shared';
import type { GenOutput, GenRequest, GenResult, ProviderAdapter, ResumeContext } from './types';
import { modelRef } from './types';

// api.nano-gpt.com serves an outdated catalog (no GPT-6, Opus 5.5, Seedream 5 Flash...); the root host is current.
export const NANO_BASE = 'https://nano-gpt.com/api';
const BASE = NANO_BASE;
const DAY = 24 * 3600 * 1000;

type Loose = Record<string, unknown>;

interface NanoImageModel {
  id: string;
  name?: string;
  description?: string;
  architecture?: { modality?: string; input_modalities?: string[] };
  pricing?: { per_image?: Record<string, number> } & Loose;
  capabilities?: { image_to_image?: boolean; image_generation?: boolean };
  supported_parameters?: Loose;
  tags?: string[];
}

interface NanoVideoParam {
  type?: string;
  label?: string;
  description?: string;
  default?: unknown;
  options?: Array<{ value: string | number; label?: string }>;
  min?: number;
  max?: number;
  step?: number;
}

interface NanoVideoModel {
  id: string;
  name?: string;
  description?: string;
  pricing?: Loose;
  capabilities?: { text_to_video?: boolean; image_to_video?: boolean; video_to_video?: boolean; audio_generation?: boolean };
  architecture?: { input_modalities?: string[] };
  tags?: string[];
  supported_parameters?: { parameters?: Record<string, NanoVideoParam> };
}

/** Takes a source video (edit, extend…), sent as `videoDataUrl` per NanoGPT's generate-video docs. */
function takesVideo(m: NanoVideoModel): boolean {
  return Boolean(m.capabilities?.video_to_video && m.architecture?.input_modalities?.includes('video'));
}

/** Edit/extend endpoints cannot run without a clip; multi-mode models (Seedance 2.5, Wan 3.0 Prime…) only accept one. */
function needsVideo(m: NanoVideoModel): boolean {
  if (!takesVideo(m)) return false;
  return /(edit|extend|motion-control)/.test(m.id) || (!m.capabilities?.text_to_video && !m.capabilities?.image_to_video);
}

/** NanoGPT documents a 4 MB limit for `videoDataUrl`. */
const MAX_VIDEO_DATA_URL_BYTES = 4 * 1024 * 1024;

/** "Up to 9 reference images" → 9. */
function upTo(d: NanoVideoParam | undefined, fallback: number): number {
  const m = /up to (\d+)/i.exec(d?.description ?? '');
  return m ? Number(m[1]) : fallback;
}

const imageRaw = new Map<string, NanoImageModel>();
const videoRaw = new Map<string, NanoVideoModel>();

function nanoHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, 'x-api-key': key };
}

async function fetchImages(): Promise<NanoImageModel[]> {
  const cached = await cacheDb.get<NanoImageModel[]>('nano:v2:images', DAY / 2);
  if (cached) return cached;
  const res = await requestJson<{ data: NanoImageModel[] }>(`${BASE}/v1/images/models`);
  await cacheDb.set('nano:v2:images', res.data);
  return res.data;
}

async function fetchVideos(): Promise<NanoVideoModel[]> {
  const cached = await cacheDb.get<NanoVideoModel[]>('nano:v2:videos', DAY / 2);
  if (cached) return cached;
  const res = await requestJson<{ data: NanoVideoModel[] }>(`${BASE}/v1/video-models?detailed=true`);
  await cacheDb.set('nano:v2:videos', res.data);
  return res.data;
}

function num(v: unknown): number | undefined {
  return numberOrUndefined(v);
}

function tableSkus(table: unknown, unit: PriceSku['unit'], extra: Partial<PriceSku> = {}): PriceSku[] {
  if (!table || typeof table !== 'object') return [];
  const out: PriceSku[] = [];
  for (const [k, v] of Object.entries(table as Loose)) {
    const usd = num(v);
    if (usd == null) continue;
    out.push({ unit, usd, resolution: k === 'auto' || k === 'default' ? undefined : k, ...extra });
  }
  return out;
}

export function parseNanoImagePrice(p: NanoImageModel['pricing']): PriceRule | undefined {
  if (!p) return undefined;
  const skus = tableSkus(p.per_image, 'output');
  if (skus.length) return { skus };
  const flat = num(p.per_image ?? p.price ?? p.cost);
  if (flat != null) return { skus: [{ unit: 'output', usd: flat }] };
  return undefined;
}

export function parseNanoVideoPrice(p: Loose | undefined): PriceRule | undefined {
  if (!p) return undefined;
  const skus: PriceSku[] = [];
  const perSecond = num(p.per_second);
  if (perSecond != null) skus.push({ unit: 'second', usd: perSecond });
  skus.push(...tableSkus(p.per_second_by_resolution, 'second'));
  skus.push(...tableSkus(p.text_to_video_per_second, 'second', { mode: 'text' }));
  skus.push(...tableSkus(p.image_to_video_per_second, 'second', { mode: 'image' }));
  skus.push(...tableSkus(p.standard_prices_per_second, 'second'));
  if (p.per_duration && typeof p.per_duration === 'object') {
    for (const [d, v] of Object.entries(p.per_duration as Loose)) {
      const usd = num(v);
      const duration = num(d);
      if (usd != null && duration != null) skus.push({ unit: 'output', usd, duration });
    }
  }
  const raw = p.raw as Loose | undefined;
  let approximate = false;
  if (raw && typeof raw === 'object') {
    approximate = true;
    skus.push(...tableSkus(raw.textToVideoPricesPerSecond, 'second', { mode: 'text' }));
    skus.push(...tableSkus(raw.imageToVideoPricesPerSecond, 'second', { mode: 'image' }));
    skus.push(...tableSkus(raw.withAudioPricesPerSecond, 'second', { audio: true }));
    skus.push(...tableSkus(raw.withoutAudioPricesPerSecond, 'second', { audio: false }));
    skus.push(...tableSkus(raw.standardTextToVideoPricesPerSecond, 'second', { mode: 'text' }));
    skus.push(...tableSkus(raw.standardImageToVideoPricesPerSecond, 'second', { mode: 'image' }));
  }
  const minimumUsd = num(p.minimum);
  const audioMultiplier = num(p.audio_multiplier);
  const note = typeof p.note === 'string' ? p.note : undefined;
  if (!skus.length) return { skus: [], minimumUsd, note: note ?? 'Price varies; see the provider quote' };
  return { skus, minimumUsd, audioMultiplier, approximate, note };
}

function classifyResolutions(values: string[]): 'sizes' | 'tiers' | 'ratios' | 'mixed' {
  const isSize = (v: string) => /^\d+\s*[x*]\s*\d+$/i.test(v);
  const isTier = (v: string) => /^\d+(\.\d+)?k$/i.test(v) || /^\d+p$/i.test(v);
  const isRatio = (v: string) => /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(v);
  if (values.every(isSize)) return 'sizes';
  if (values.every(isTier)) return 'tiers';
  if (values.every(isRatio)) return 'ratios';
  return 'mixed';
}

function toStrings(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (v && typeof v === 'object' && Array.isArray((v as Loose).values)) return ((v as Loose).values as unknown[]).map(String);
  return [];
}

function imageSchema(model: ModelSummary, raw: NanoImageModel): ModelSchema {
  const sp = raw.supported_parameters ?? {};
  const params: ParamDef[] = [];
  const resolutions = toStrings(sp.resolutions ?? sp.resolution).filter((v) => v !== 'auto');
  const aspects = toStrings(sp.aspect_ratio);
  if (resolutions.length) {
    const cls = classifyResolutions(resolutions);
    if (cls === 'sizes' || (cls === 'ratios' && !aspects.length)) {
      params.push({ key: 'resolution', label: cls === 'sizes' ? 'Size' : 'Aspect ratio', role: 'aspect', type: 'enum', options: resolutions });
    } else {
      params.push({ key: 'resolution', label: 'Resolution', role: 'resolution', type: 'enum', options: resolutions });
    }
  }
  if (aspects.length) params.push({ key: 'aspect_ratio', label: 'Aspect ratio', role: 'aspect', type: 'enum', options: aspects });
  const maxOut = num(sp.max_output_images ?? sp.max_images) ?? num((sp.n as Loose | undefined)?.max);
  if (maxOut && maxOut > 1) params.push({ key: 'n', label: 'Images', role: 'count', type: 'integer', min: 1, max: maxOut, default: 1 });
  // Docs-style enum/range parameters (quality, output_format, seed...).
  for (const [key, def] of Object.entries(sp)) {
    if (['resolutions', 'resolution', 'aspect_ratio', 'max_images', 'max_output_images', 'max_input_images', 'n', 'input_image_constraints'].includes(key)) continue;
    if (!def || typeof def !== 'object' || isHiddenKey(key)) continue;
    const d = def as Loose;
    if (d.type === 'enum' && Array.isArray(d.values) && d.values.length) {
      const options = (d.values as unknown[]).map(String);
      params.push({ key, label: humanizeKey(key), role: roleForKey(key, options), type: 'enum', options, default: d.default as string | undefined });
    } else if (d.type === 'range') {
      params.push({ key, label: humanizeKey(key), role: roleForKey(key), type: 'integer', min: num(d.min), max: num(d.max), default: num(d.default) });
    }
  }
  const maxIn = num(sp.max_input_images) ?? 0;
  const inputs = raw.architecture?.input_modalities ?? ['text'];
  const needsImage = !inputs.includes('text') || /(^|[/-])(edit|image-to-image|img2img)/.test(raw.id);
  return {
    ref: model.ref,
    params,
    slots: {
      prompt: inputs.includes('text') ? 'prompt' : undefined,
      promptRequired: inputs.includes('text') && !needsImage,
      // POST /api/v1/images ignores `input_references` (despite the docs) and reads `imageDataUrls`; verified 2026-09-25.
      images: maxIn > 0 || needsImage ? { key: 'imageDataUrls', max: Math.max(1, maxIn), min: needsImage ? 1 : 0, multiple: true, format: 'data-url' } : undefined,
    },
    price: model.price,
    source: 'catalog',
  };
}

function videoSchema(model: ModelSummary, raw: NanoVideoModel): ModelSchema {
  const defs = raw.supported_parameters?.parameters ?? {};
  const params: ParamDef[] = [];
  for (const [key, d] of Object.entries(defs)) {
    if (isHiddenKey(key) || /trajectory|keyframe|script|story|voice|character|lora/i.test(key)) continue;
    const type = (d.type ?? '').toLowerCase();
    const role = roleForKey(key, d.options?.map((o) => o.value));
    const label = d.label ?? humanizeKey(key);
    if ((type === 'select' || type === 'enum' || type === 'radio') && d.options?.length) {
      const options = d.options.map((o) => o.value);
      params.push({ key, label, role, type: 'enum', options, default: d.default as string | number | undefined, description: d.description });
    } else if (type === 'boolean' || type === 'toggle' || type === 'switch') {
      params.push({ key, label, role, type: 'boolean', default: typeof d.default === 'boolean' ? d.default : undefined, description: d.description });
    } else if (type === 'number' || type === 'integer' || type === 'slider') {
      params.push({ key, label, role, type: type === 'integer' ? 'integer' : 'number', min: d.min, max: d.max, step: d.step, default: num(d.default), description: d.description });
    } else if (role === 'negative') {
      params.push({ key, label, role, type: 'string' });
    }
  }
  if (!params.some((p) => p.role === 'audio') && raw.capabilities?.audio_generation) {
    params.push({ key: 'generateAudio', label: 'Audio', role: 'audio', type: 'boolean', default: false });
  }
  const i2v = Boolean(raw.capabilities?.image_to_video);
  const t2v = Boolean(raw.capabilities?.text_to_video);
  const inputs = raw.architecture?.input_modalities ?? [];
  // Reference lists: the catalog declares them as reference_images/_videos (URL fields); the video guide
  // documents referenceImages/referenceVideos with URLs or data URLs, which is what we can send.
  const modes = defs.mode?.options?.map((o) => String(o.value)) ?? [];
  const refModel = /reference-to-video/.test(raw.id);
  const takesRefs = refModel || 'reference_images' in defs || modes.includes('reference-to-video');
  return {
    ref: model.ref,
    params,
    slots: {
      prompt: 'prompt',
      promptRequired: t2v && !i2v && !takesVideo(raw),
      firstFrame: i2v && !needsVideo(raw) && !refModel ? { key: 'imageDataUrl', format: 'data-url' } : undefined,
      lastFrame: 'last_image' in defs ? { key: 'last_image', format: 'data-url' } : undefined,
      images: takesRefs && inputs.includes('image')
        ? { key: 'referenceImages', max: upTo(defs.reference_images, 4), min: refModel && !inputs.includes('text') ? 1 : 0, multiple: true, format: 'data-url' }
        : undefined,
      refVideos: 'reference_videos' in defs ? { key: 'referenceVideos', max: upTo(defs.reference_videos, 3), min: 0, format: 'data-url' } : undefined,
      video: takesVideo(raw) ? { key: 'videoDataUrl', format: 'data-url' } : undefined,
    },
    price: model.price,
    source: 'catalog',
  };
}

export const nanogpt: ProviderAdapter = {
  id: 'nanogpt',
  label: 'NanoGPT',

  async listModels() {
    const [images, videos] = await Promise.all([fetchImages(), fetchVideos()]);
    const out: ModelSummary[] = [];
    for (const m of images) {
      imageRaw.set(m.id, m);
      const inputs = m.architecture?.input_modalities ?? ['text'];
      const sp = m.supported_parameters ?? {};
      const maxIn = num(sp.max_input_images) ?? 0;
      out.push({
        ref: modelRef('nanogpt', m.id),
        provider: 'nanogpt',
        id: m.id,
        name: m.name ?? m.id,
        kind: 'image',
        acceptsText: inputs.includes('text'),
        acceptsImage: inputs.includes('image') && (maxIn > 0 || Boolean(m.capabilities?.image_to_image)),
        tags: m.tags ?? [],
        description: m.description,
        price: parseNanoImagePrice(m.pricing),
      });
    }
    for (const m of videos) {
      const video = takesVideo(m);
      if (!m.capabilities?.text_to_video && !m.capabilities?.image_to_video && !video) continue;
      videoRaw.set(m.id, m);
      out.push({
        ref: modelRef('nanogpt', m.id),
        provider: 'nanogpt',
        id: m.id,
        name: m.name ?? m.id,
        kind: 'video',
        acceptsText: Boolean(m.capabilities?.text_to_video) || (video && Boolean(m.architecture?.input_modalities?.includes('text'))),
        acceptsImage: Boolean(m.capabilities?.image_to_video) && !needsVideo(m),
        acceptsVideo: video,
        needsVideo: needsVideo(m),
        tags: video ? (m.tags ?? []) : [],
        description: m.description,
        price: parseNanoVideoPrice(m.pricing),
      });
    }
    return out;
  },

  async loadSchema(model) {
    if (!(model.kind === 'image' ? imageRaw : videoRaw).has(model.id)) await nanogpt.listModels(undefined);
    if (model.kind === 'image') {
      const raw = imageRaw.get(model.id);
      if (!raw) throw new Error(`Unknown NanoGPT image model ${model.id}`);
      return imageSchema(model, raw);
    }
    const raw = videoRaw.get(model.id);
    if (!raw) throw new Error(`Unknown NanoGPT video model ${model.id}`);
    return videoSchema(model, raw);
  },

  async generate(req: GenRequest): Promise<GenResult> {
    const body: Record<string, unknown> = { model: req.model.id, ...wireParams(req.schema, req.settings, req.count) };
    if (req.prompt) body.prompt = req.prompt;

    if (req.kind === 'image') {
      if (req.refs.length && req.schema.slots.images) {
        body[req.schema.slots.images.key] = await Promise.all(req.refs.slice(0, req.schema.slots.images.max).map((r) => encodeImage(r, 'data-url')));
      }
      req.onStatus('Generating');
      const res = await requestJson<Loose>(`${BASE}/v1/images`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, ...nanoHeaders(req.apiKey) },
        body: JSON.stringify(body),
        signal: req.signal,
      });
      const outputs = await materialize(extractOutputs(res, 'image'), req.signal);
      if (!outputs.length) throw new Error('NanoGPT returned no images');
      return { outputs, costUsd: num(res.cost) };
    }

    const { slots } = req.schema;
    if (req.firstFrame && slots.firstFrame) body[slots.firstFrame.key] = await encodeImage(req.firstFrame, 'data-url');
    if (req.lastFrame && slots.lastFrame) body[slots.lastFrame.key] = await encodeImage(req.lastFrame, 'data-url');
    if (req.refs.length && slots.images) body[slots.images.key] = await Promise.all(req.refs.slice(0, slots.images.max).map((r) => encodeImage(r, 'data-url')));
    if (req.refVideos?.length && slots.refVideos) body[slots.refVideos.key] = await Promise.all(req.refVideos.slice(0, slots.refVideos.max).map((v) => encodeVideo(v)));
    if (req.video && slots.video) {
      if (req.video.blob.size > MAX_VIDEO_DATA_URL_BYTES) throw new Error(`NanoGPT accepts source videos up to 4 MB (this one is ${(req.video.blob.size / 1048576).toFixed(1)} MB). Trim it or use Atlas Cloud.`);
      body[slots.video.key] = await encodeVideo(req.video);
    }
    // Some aspect params are orientation based; keep the ratio-derived value only when valid.
    if (typeof body.aspect_ratio === 'string' && ratioOf(body.aspect_ratio) == null && body.aspect_ratio !== 'auto') delete body.aspect_ratio;
    req.onStatus('Submitting');
    const submit = await requestJson<Loose>(`${BASE}/generate-video`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...nanoHeaders(req.apiKey) },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    const id = String(submit.runId ?? submit.id ?? submit.requestId ?? '');
    if (!id) throw new Error('NanoGPT did not return a job id');
    const job: RemoteJob = { provider: 'nanogpt', id, meta: { submitCost: String(submit.cost ?? '') } };
    req.onRemoteJob(job);
    return pollVideo(job, { kind: 'video', apiKey: req.apiKey, signal: req.signal, onStatus: req.onStatus });
  },

  async balance(apiKey, signal) {
    const res = await requestJson<{ usd_balance?: string | number }>(`${BASE}/check-balance`, { method: 'POST', headers: nanoHeaders(apiKey), signal });
    return numberOrUndefined(res.usd_balance);
  },

  resume(job, ctx) {
    return pollVideo(job, ctx);
  },
};

async function materialize(outputs: GenOutput[], signal: AbortSignal): Promise<GenOutput[]> {
  return Promise.all(
    outputs.map(async (o) => {
      if (o.blob || !o.url) return o;
      try {
        return { blob: await fetchBlob(o.url, { signal }), mime: o.mime };
      } catch {
        return o;
      }
    }),
  );
}

function pollVideo(job: RemoteJob, ctx: ResumeContext): Promise<GenResult> {
  return pollJob(ctx, 'NanoGPT', 5000, async () => {
    const res = await requestJson<Loose>(`${BASE}/video/status?requestId=${encodeURIComponent(job.id)}`, {
      headers: { 'x-api-key': ctx.apiKey },
      signal: ctx.signal,
      timeoutMs: POLL_TIMEOUT_MS,
    });
    const data = (res.data ?? res) as Loose;
    const status = String(data.status ?? '').toUpperCase();
    if (status === 'COMPLETED') {
      const outputs = await materialize(extractOutputs(res, 'video'), ctx.signal);
      if (!outputs.length) throw new JobFailedError('NanoGPT finished without a video URL');
      return { outputs, costUsd: num(data.cost) ?? num(job.meta.submitCost) };
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'CANCELLED') {
      throw new JobFailedError(extractErrorMessage(data, `Video ${status.toLowerCase()}`));
    }
    return status === 'IN_QUEUE' || status === 'PENDING' || status === 'QUEUED' ? 'Queued' : 'Rendering';
  });
}
