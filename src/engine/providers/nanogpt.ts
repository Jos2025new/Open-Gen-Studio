import { cacheDb } from '../../lib/idb';
import { extractErrorMessage, JobFailedError, requestJson } from '../../lib/http';
import { extensionForMime, fetchBlob } from '../../lib/media';
import { humanizeKey, ratioOf, roleForKey, wireParams, isHiddenKey } from '../params';
import type { ModelSchema, ModelSummary, ParamDef, PriceRule, PriceSku, RemoteJob, TranscriberSummary } from '../types';
import { encodeImage, encodeVideo, extractOutputs, JSON_HEADERS, numberOrUndefined, POLL_TIMEOUT_MS, pollJob } from './shared';
import type { GenOutput, GenRequest, GenResult, ProviderAdapter, ResumeContext, TranscribeRequest } from './types';
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

interface NanoAudioModel {
  id: string;
  name?: string;
  architecture?: { input_modalities?: string[] };
  pricing?: { per_minute?: number };
  capabilities?: { speech_to_text?: boolean; diarization?: boolean };
  supported_parameters?: { max_request_body_mb?: number; supported_languages?: string[] };
}

async function fetchAudioModels(): Promise<NanoAudioModel[]> {
  const cached = await cacheDb.get<NanoAudioModel[]>('nano:v1:audio', DAY / 2);
  if (cached) return cached;
  const res = await requestJson<{ data: NanoAudioModel[] }>(`${BASE}/v1/audio-models?detailed=true`);
  await cacheDb.set('nano:v1:audio', res.data);
  return res.data;
}

/** Files sent directly to /transcribe: the docs allow multipart uploads up to 3 MB. */
const TRANSCRIBE_DIRECT_BYTES = 3 * 1024 * 1024;

function pollTranscription(job: RemoteJob, ctx: ResumeContext): Promise<GenResult> {
  return pollJob(ctx, 'NanoGPT', 3000, async () => {
    const res = await requestJson<Loose>(`${BASE}/transcribe/status`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...nanoHeaders(ctx.apiKey) },
      body: JSON.stringify({ runId: job.id, cost: num(job.meta.cost), paymentSource: job.meta.paymentSource || undefined, isApiRequest: true }),
      signal: ctx.signal,
      timeoutMs: POLL_TIMEOUT_MS,
    });
    const status = String(res.status ?? '').toLowerCase();
    if (status === 'completed' || typeof res.transcription === 'string') {
      return { outputs: [], text: transcriptionText(res), costUsd: num(res.cost) ?? num(job.meta.cost) };
    }
    if (status === 'failed' || status === 'error') throw new JobFailedError(extractErrorMessage(res, 'Transcription failed'));
    return status === 'pending' ? 'Queued' : 'Transcribing';
  });
}

/** The text of a finished transcription: `transcription`, else the diarized segments joined. */
function transcriptionText(res: Loose): string {
  if (typeof res.transcription === 'string') return res.transcription;
  if (typeof res.text === 'string') return res.text;
  const segments = (res.diarization as Loose | undefined)?.segments;
  if (Array.isArray(segments)) return segments.map((s) => `${(s as Loose).speaker ? `${(s as Loose).speaker}: ` : ''}${(s as Loose).text ?? ''}`).join('\n');
  return '';
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
    // Seedream V5 Pro mixes ratios and tiers ("16:9", "2k") in one field: without an aspect field it is the framing.
    const framing = cls === 'sizes' || (!aspects.length && (cls === 'ratios' || (cls === 'mixed' && resolutions.some((r) => ratioOf(r) != null))));
    if (framing) {
      params.push({ key: 'resolution', label: cls === 'ratios' ? 'Aspect ratio' : 'Size', role: 'aspect', type: 'enum', options: resolutions });
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
    } else if (Array.isArray(def) && def.length && def.every((v) => typeof v === 'string' || typeof v === 'number')) {
      // Plain value lists, e.g. Ideogram rendering_speed: ["TURBO", "BALANCED", "QUALITY"].
      const options = (def as Array<string | number>).map(String);
      params.push({ key, label: humanizeKey(key), role: roleForKey(key, options), type: 'enum', options });
    }
  }
  const maxIn = num(sp.max_input_images) ?? 0;
  const inputs = raw.architecture?.input_modalities ?? ['text'];
  const needsImage = !inputs.includes('text') || /(^|[/-])(edit|image-to-image|img2img)/.test(raw.id);
  // Some text-only endpoints still declare max_input_images; images are only sent where the model takes them.
  const takesImages = inputs.includes('image') && (maxIn > 0 || needsImage);
  return {
    ref: model.ref,
    params,
    slots: {
      prompt: inputs.includes('text') ? 'prompt' : undefined,
      promptRequired: inputs.includes('text') && !needsImage,
      // POST /api/v1/images ignores `input_references` (despite the docs) and reads `imageDataUrls`; verified 2026-09-25.
      images: takesImages ? { key: 'imageDataUrls', max: Math.max(1, maxIn), min: needsImage ? 1 : 0, multiple: true, format: 'data-url' } : undefined,
    },
    price: model.price,
    source: 'catalog',
  };
}

/** Catalog parameters (select/switch/number) as ParamDefs; `skip` drops keys handled as input slots. */
function catalogParams(defs: Record<string, NanoVideoParam>, skip: RegExp): ParamDef[] {
  const params: ParamDef[] = [];
  for (const [key, d] of Object.entries(defs)) {
    if (isHiddenKey(key) || skip.test(key)) continue;
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
    } else if (role === 'negative' || type === 'text') {
      params.push({ key, label, role, type: 'string', description: d.description });
    }
  }
  return params;
}

function videoSchema(model: ModelSummary, raw: NanoVideoModel): ModelSchema {
  const defs = raw.supported_parameters?.parameters ?? {};
  const params = catalogParams(defs, /trajectory|keyframe|script|story|voice|character|lora/i).filter((p) => p.role === 'negative' || p.type !== 'string');
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
      // Audio: the catalog's `audio` field (Seedance talking avatar), else the documented audioDataUrl for
      // audio-driven models (lip-sync, avatar). referenceAudios follows the referenceImages/Videos naming (unverified).
      audio:
        defs.audio && (defs.audio.type ?? 'string') === 'string'
          ? { key: 'audio', required: /required/i.test(defs.audio.description ?? ''), format: 'data-url' }
          : inputs.includes('audio') && /lip-?sync|avatar/.test(raw.id)
            ? { key: 'audioDataUrl', required: true, format: 'data-url' }
            : undefined,
      refAudios: 'reference_audios' in defs ? { key: 'referenceAudios', max: upTo(defs.reference_audios, 3), min: 0, format: 'data-url' } : undefined,
      video: takesVideo(raw) ? { key: 'videoDataUrl', format: 'data-url' } : undefined,
    },
    price: model.price,
    source: 'catalog',
  };
}

interface Nano3dModel {
  id: string;
  name?: string;
  description?: string;
  pricing?: { per_run?: number; per_run_by_variant?: Record<string, number>; default_variant?: string };
  capabilities?: { text_to_3d?: boolean; image_to_3d?: boolean };
  supported_parameters?: { parameters?: Record<string, NanoVideoParam> };
}

/** 3D models chosen by the user (2026-09-25). Other catalog entries (Hunyuan, Meshy 6, Tripo P2…) stay hidden. */
export const NANO_3D_MODELS = new Set(['wavespeed-ai/trellis-2/image-to-3d', 'bytedance/seed3d-2.0', 'meshy/v7.1/text-to-3d', 'meshy/v7.1/image-to-3d', 'meshy/v7.1/multi-image-to-3d']);

const model3dRaw = new Map<string, Nano3dModel>();

async function fetch3dModels(): Promise<Nano3dModel[]> {
  const cached = await cacheDb.get<Nano3dModel[]>('nano:v1:3d', DAY / 2);
  if (cached) return cached;
  const res = await requestJson<{ data: Nano3dModel[] }>(`${BASE}/v1/3d-models?detailed=true`);
  await cacheDb.set('nano:v1:3d', res.data);
  return res.data;
}

export function parseNano3dPrice(p: Nano3dModel['pricing']): PriceRule | undefined {
  const base = num(p?.per_run_by_variant?.[p?.default_variant ?? '']) ?? num(p?.per_run);
  if (base == null) return undefined;
  const variants = p?.per_run_by_variant;
  const values = Object.values(variants ?? {});
  const range = values.length > 1 ? `${Math.min(...values)}–${Math.max(...values)} USD per model depending on options` : undefined;
  return { skus: [{ unit: 'output', usd: base }], ...(variants ? { variants } : {}), note: range };
}

/**
 * NanoGPT 3D runs through /generate-video (documented example on each model page) with the image as
 * `imageDataUrl`. Meshy multi-image: the first view in `imageDataUrl` (documented) and all views in
 * `imageDataUrls` (unverified; same name as the images API).
 */
export function model3dSchema(model: ModelSummary, raw: Nano3dModel): ModelSchema {
  const defs = raw.supported_parameters?.parameters ?? {};
  const multi = /multi-image/.test(raw.id);
  const t = Boolean(raw.capabilities?.text_to_3d);
  const i = Boolean(raw.capabilities?.image_to_3d);
  return {
    ref: model.ref,
    // texture_image is a URL field: not something the app can fill from a local asset.
    params: catalogParams(defs, /^texture_image$/),
    slots: {
      prompt: t || 'prompt' in defs ? 'prompt' : undefined,
      promptRequired: t && !i,
      images: i ? (multi ? { key: 'imageDataUrls', max: 4, min: 1, multiple: true, format: 'data-url' } : { key: 'imageDataUrl', max: 1, min: 1, multiple: false, format: 'data-url' }) : undefined,
    },
    price: model.price,
    source: 'catalog',
  };
}

export const nanogpt: ProviderAdapter = {
  id: 'nanogpt',
  label: 'NanoGPT',

  async listModels() {
    const [images, videos, models3d] = await Promise.all([fetchImages(), fetchVideos(), fetch3dModels().catch(() => [] as Nano3dModel[])]);
    const out: ModelSummary[] = [];
    for (const m of models3d) {
      if (!NANO_3D_MODELS.has(m.id)) continue;
      model3dRaw.set(m.id, m);
      out.push({
        ref: modelRef('nanogpt', m.id),
        provider: 'nanogpt',
        id: m.id,
        name: m.name ?? m.id,
        kind: 'model3d',
        acceptsText: Boolean(m.capabilities?.text_to_3d),
        acceptsImage: Boolean(m.capabilities?.image_to_3d),
        tags: [],
        description: m.description,
        price: parseNano3dPrice(m.pricing),
      });
    }
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
    if (!(model.kind === 'image' ? imageRaw : model.kind === 'model3d' ? model3dRaw : videoRaw).has(model.id)) await nanogpt.listModels(undefined);
    if (model.kind === 'model3d') {
      const raw = model3dRaw.get(model.id);
      if (!raw) throw new Error(`Unknown NanoGPT 3D model ${model.id}`);
      return model3dSchema(model, raw);
    }
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
    if (req.kind === 'model3d') {
      if (req.refs.length && slots.images) {
        const urls = await Promise.all(req.refs.slice(0, slots.images.max).map((r) => encodeImage(r, 'data-url')));
        body.imageDataUrl = urls[0];
        if (slots.images.multiple) body[slots.images.key] = urls;
      }
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
      return pollVideo(job, { kind: 'model3d', apiKey: req.apiKey, signal: req.signal, onStatus: req.onStatus });
    }
    if (req.firstFrame && slots.firstFrame) body[slots.firstFrame.key] = await encodeImage(req.firstFrame, 'data-url');
    if (req.lastFrame && slots.lastFrame) body[slots.lastFrame.key] = await encodeImage(req.lastFrame, 'data-url');
    if (req.refs.length && slots.images) body[slots.images.key] = await Promise.all(req.refs.slice(0, slots.images.max).map((r) => encodeImage(r, 'data-url')));
    if (req.refVideos?.length && slots.refVideos) body[slots.refVideos.key] = await Promise.all(req.refVideos.slice(0, slots.refVideos.max).map((v) => encodeVideo(v)));
    if (req.audio && slots.audio) body[slots.audio.key] = await encodeVideo(req.audio);
    if (req.refAudios?.length && slots.refAudios) body[slots.refAudios.key] = await Promise.all(req.refAudios.slice(0, slots.refAudios.max).map((a) => encodeVideo(a)));
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

  async listTranscribers() {
    const models = await fetchAudioModels();
    return models
      .filter((m) => m.capabilities?.speech_to_text && !/voice-clone/i.test(m.id))
      .map(
        (m): TranscriberSummary => ({
          ref: modelRef('nanogpt', m.id),
          provider: 'nanogpt',
          id: m.id,
          name: m.name ?? m.id,
          usdPerMinute: num(m.pricing?.per_minute),
          maxDirectBytes: Math.min(TRANSCRIBE_DIRECT_BYTES, (num(m.supported_parameters?.max_request_body_mb) ?? 3) * 1024 * 1024),
          video: Boolean(m.architecture?.input_modalities?.includes('video')),
          diarization: Boolean(m.capabilities?.diarization),
          languages: m.supported_parameters?.supported_languages,
        }),
      );
  },

  async transcribe(req: TranscribeRequest): Promise<GenResult> {
    const form = new FormData();
    form.append('audio', req.input.blob, `input.${extensionForMime(req.input.mime || req.input.blob.type)}`);
    form.append('model', req.model.id);
    form.append('language', req.language || 'auto');
    req.onStatus('Transcribing');
    const res = await requestJson<Loose>(`${BASE}/transcribe`, { method: 'POST', headers: nanoHeaders(req.apiKey), body: form, signal: req.signal });
    if (typeof res.transcription === 'string') return { outputs: [], text: res.transcription, costUsd: num((res.metadata as Loose | undefined)?.cost) };
    // Long files run as a job (HTTP 202): keep it so a reload or a failed check can resume.
    const runId = String(res.runId ?? '');
    if (!runId) throw new Error('NanoGPT returned no transcription');
    const job: RemoteJob = { provider: 'nanogpt', id: runId, meta: { kind: 'transcribe', cost: String(res.cost ?? ''), paymentSource: String(res.paymentSource ?? '') } };
    req.onRemoteJob(job);
    return pollTranscription(job, { kind: 'text', apiKey: req.apiKey, signal: req.signal, onStatus: req.onStatus });
  },

  async balance(apiKey, signal) {
    const res = await requestJson<{ usd_balance?: string | number }>(`${BASE}/check-balance`, { method: 'POST', headers: nanoHeaders(apiKey), signal });
    return numberOrUndefined(res.usd_balance);
  },

  resume(job, ctx) {
    return job.meta.kind === 'transcribe' ? pollTranscription(job, ctx) : pollVideo(job, ctx);
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
      const is3d = ctx.kind === 'model3d';
      const outputs = await materialize(extractOutputs(res, is3d ? 'model3d' : 'video'), ctx.signal);
      if (!outputs.length) throw new JobFailedError(is3d ? 'NanoGPT finished without a 3D file URL' : 'NanoGPT finished without a video URL');
      return { outputs, costUsd: num(data.cost) ?? num(job.meta.submitCost) };
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'CANCELLED') {
      throw new JobFailedError(extractErrorMessage(data, `Video ${status.toLowerCase()}`));
    }
    return status === 'IN_QUEUE' || status === 'PENDING' || status === 'QUEUED' ? 'Queued' : 'Rendering';
  });
}
