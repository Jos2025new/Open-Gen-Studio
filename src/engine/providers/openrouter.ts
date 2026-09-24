import { cacheDb } from '../../lib/idb';
import { HttpError, requestJson, sleep } from '../../lib/http';
import { fetchBlob } from '../../lib/media';
import { roleForKey, humanizeKey, wireParams } from '../params';
import type { ModelSchema, ModelSummary, ParamDef, PriceRule, PriceSku, RemoteJob } from '../types';
import { encodeImage, extractOutputs, JSON_HEADERS, numberOrUndefined } from './shared';
import type { GenRequest, GenResult, ProviderAdapter, ResumeContext } from './types';
import { modelRef } from './types';

const BASE = 'https://openrouter.ai/api/v1';
const DAY = 24 * 3600 * 1000;

interface RangeParam {
  type: 'range';
  min: number | null;
  max: number | null;
}
interface EnumParam {
  type: 'enum';
  values: string[];
}
type SupportedParam = RangeParam | EnumParam;

interface OrImageModel {
  id: string;
  name: string;
  description?: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: Record<string, SupportedParam>;
}

interface OrVideoModel {
  id: string;
  name: string;
  description?: string;
  supported_resolutions: string[] | null;
  supported_aspect_ratios: string[] | null;
  supported_durations: number[] | null;
  supported_frame_images: string[] | null;
  generate_audio: boolean | null;
  seed: boolean | null;
  pricing_skus?: Record<string, string> | null;
}

const imageRaw = new Map<string, OrImageModel>();
const videoRaw = new Map<string, OrVideoModel>();

export function orHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    'HTTP-Referer': typeof location !== 'undefined' ? location.origin : 'http://localhost',
    'X-Title': 'Open Gen Studio',
  };
}

async function fetchImageModels(): Promise<OrImageModel[]> {
  const cached = await cacheDb.get<OrImageModel[]>('or:images', DAY / 2);
  if (cached) return cached;
  const res = await requestJson<{ data: OrImageModel[] }>(`${BASE}/images/models`);
  await cacheDb.set('or:images', res.data);
  return res.data;
}

async function fetchVideoModels(): Promise<OrVideoModel[]> {
  const cached = await cacheDb.get<OrVideoModel[]>('or:videos', DAY / 2);
  if (cached) return cached;
  const res = await requestJson<{ data: OrVideoModel[] }>(`${BASE}/videos/models`);
  await cacheDb.set('or:videos', res.data);
  return res.data;
}

/** Parse OpenRouter video `pricing_skus` into normalized SKUs. */
export function parseOrVideoPricing(skus: Record<string, string> | null | undefined): PriceRule {
  const out: PriceSku[] = [];
  let minimumUsd: number | undefined;
  for (const [k, raw] of Object.entries(skus ?? {})) {
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) continue;
    if (k === 'minimum_cents_per_generation') {
      minimumUsd = v / 100;
      continue;
    }
    let m = /^(text_to_video_|image_to_video_)?duration_seconds(?:_(with|without)_audio)?(?:_(\w+))?$/.exec(k);
    if (m) {
      out.push({
        unit: 'second',
        usd: v,
        mode: m[1] === 'text_to_video_' ? 'text' : m[1] === 'image_to_video_' ? 'image' : undefined,
        audio: m[2] === 'with' ? true : m[2] === 'without' ? false : undefined,
        resolution: m[3],
      });
      continue;
    }
    m = /^cents_per_(?:second_output|video_output_second)(?:_(\w+))?$/.exec(k);
    if (m) {
      out.push({ unit: 'second', usd: v / 100, resolution: m[1] });
    }
  }
  if (!out.length) return { skus: [], minimumUsd, note: 'Token-billed; exact cost is reported after generation' };
  return { skus: out, minimumUsd };
}

function paramFromSupported(key: string, sp: SupportedParam): ParamDef | null {
  const role = roleForKey(key);
  if (sp.type === 'enum') {
    if (!sp.values?.length) return null;
    return { key, label: humanizeKey(key), role, type: 'enum', options: sp.values };
  }
  if (key === 'seed') return { key, label: 'Seed', role: 'seed', type: 'integer' };
  const min = sp.min ?? undefined;
  const max = sp.max ?? undefined;
  if (role === 'count' && (max ?? 1) <= 1) return null;
  return { key, label: humanizeKey(key), role, type: 'integer', min, max, step: 1, default: role === 'count' ? 1 : undefined };
}

async function imagePrice(id: string): Promise<PriceRule> {
  const cacheKey = `or:price:${id}`;
  const cached = await cacheDb.get<PriceRule>(cacheKey, DAY);
  if (cached) return cached;
  let rule: PriceRule = { skus: [], note: 'Billed by tokens; exact cost is reported after generation' };
  try {
    const res = await requestJson<{ endpoints?: Array<{ pricing?: Array<{ billable: string; unit: string; cost_usd: number; resolution?: string }> }> }>(
      `${BASE}/images/models/${id}/endpoints`,
    );
    const pricing = res.endpoints?.[0]?.pricing ?? [];
    const skus: PriceSku[] = pricing
      .filter((p) => p.unit === 'image' && /output/.test(p.billable) && Number.isFinite(p.cost_usd))
      .map((p) => ({ unit: 'output' as const, usd: p.cost_usd, resolution: p.resolution }));
    const mp = pricing.find((p) => /megapixel/i.test(p.unit) && Number.isFinite(p.cost_usd));
    if (skus.length) rule = { skus };
    else if (mp) rule = { skus: [{ unit: 'megapixel', usd: mp.cost_usd }], approximate: true };
  } catch {
    /* keep token-billed note */
  }
  await cacheDb.set(cacheKey, rule);
  return rule;
}

export const openrouter: ProviderAdapter = {
  id: 'openrouter',
  label: 'OpenRouter',

  async listModels() {
    const [images, videos] = await Promise.all([fetchImageModels(), fetchVideoModels()]);
    const out: ModelSummary[] = [];
    for (const m of images) {
      imageRaw.set(m.id, m);
      const inputs = m.architecture?.input_modalities ?? ['text'];
      const refs = m.supported_parameters?.input_references;
      const maxRefs = refs && refs.type === 'range' ? refs.max ?? 0 : 0;
      const fmt = m.supported_parameters?.output_format;
      out.push({
        ref: modelRef('openrouter', m.id),
        provider: 'openrouter',
        id: m.id,
        name: m.name.replace(/^[^:]+:\s*/, ''),
        kind: 'image',
        acceptsText: inputs.includes('text'),
        acceptsImage: inputs.includes('image') && maxRefs > 0,
        tags: fmt && fmt.type === 'enum' && fmt.values.length === 1 && fmt.values[0] === 'svg' ? ['vector'] : [],
        description: m.description,
      });
    }
    for (const m of videos) {
      // Video-to-video tools (edit, upscale, avatars) need inputs we do not drive.
      if (!m.supported_durations?.length) continue;
      videoRaw.set(m.id, m);
      out.push({
        ref: modelRef('openrouter', m.id),
        provider: 'openrouter',
        id: m.id,
        name: m.name.replace(/^[^:]+:\s*/, ''),
        kind: 'video',
        acceptsText: true,
        acceptsImage: Boolean(m.supported_frame_images?.includes('first_frame')),
        tags: [],
        description: m.description,
        price: parseOrVideoPricing(m.pricing_skus),
      });
    }
    return out;
  },

  async loadSchema(model) {
    if (model.kind === 'image') {
      if (!imageRaw.has(model.id)) await openrouter.listModels(undefined);
      const raw = imageRaw.get(model.id);
      if (!raw) throw new Error(`Unknown OpenRouter image model ${model.id}`);
      const params: ParamDef[] = [];
      const sp = raw.supported_parameters ?? {};
      for (const [key, def] of Object.entries(sp)) {
        if (key === 'input_references') continue;
        const p = paramFromSupported(key, def);
        if (p) params.push(p);
      }
      const refs = sp.input_references;
      const schema: ModelSchema = {
        ref: model.ref,
        params,
        slots: {
          prompt: 'prompt',
          promptRequired: model.acceptsText,
          images:
            refs && refs.type === 'range' && (refs.max ?? 0) > 0
              ? { key: 'input_references', max: refs.max ?? 1, min: refs.min ?? 0, multiple: true, format: 'content-part' }
              : undefined,
        },
        price: await imagePrice(model.id),
        source: 'catalog',
      };
      return schema;
    }
    if (!videoRaw.has(model.id)) await openrouter.listModels(undefined);
    const raw = videoRaw.get(model.id);
    if (!raw) throw new Error(`Unknown OpenRouter video model ${model.id}`);
    const params: ParamDef[] = [];
    if (raw.supported_aspect_ratios?.length) {
      params.push({ key: 'aspect_ratio', label: 'Aspect ratio', role: 'aspect', type: 'enum', options: raw.supported_aspect_ratios });
    }
    if (raw.supported_resolutions?.length) {
      params.push({ key: 'resolution', label: 'Resolution', role: 'resolution', type: 'enum', options: raw.supported_resolutions });
    }
    if (raw.supported_durations?.length) {
      const opts = [...raw.supported_durations].sort((a, b) => a - b);
      params.push({ key: 'duration', label: 'Duration', role: 'duration', type: 'enum', options: opts, default: opts.includes(5) ? 5 : opts[0] });
    }
    if (raw.generate_audio) params.push({ key: 'generate_audio', label: 'Audio', role: 'audio', type: 'boolean', default: true });
    if (raw.seed) params.push({ key: 'seed', label: 'Seed', role: 'seed', type: 'integer' });
    const frames = raw.supported_frame_images ?? [];
    return {
      ref: model.ref,
      params,
      slots: {
        prompt: 'prompt',
        promptRequired: !frames.length,
        firstFrame: frames.includes('first_frame') ? { key: 'frame_images', format: 'content-part' } : undefined,
        lastFrame: frames.includes('last_frame') ? { key: 'frame_images', format: 'content-part' } : undefined,
      },
      price: model.price ?? parseOrVideoPricing(raw.pricing_skus),
      source: 'catalog',
    };
  },

  async generate(req: GenRequest): Promise<GenResult> {
    const { schema } = req;
    const body: Record<string, unknown> = { model: req.model.id };
    if (req.prompt) body.prompt = req.prompt;
    Object.assign(body, wireParams(schema, req.settings, req.count));

    if (req.kind === 'image') {
      if (req.refs.length && schema.slots.images) {
        body.input_references = await Promise.all(req.refs.slice(0, schema.slots.images.max).map((r) => encodeImage(r, 'content-part')));
      }
      req.onStatus('Generating');
      const res = await requestJson<Record<string, unknown>>(`${BASE}/images`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, ...orHeaders(req.apiKey) },
        body: JSON.stringify(body),
        signal: req.signal,
      });
      const outputs = extractOutputs(res, 'image');
      if (!outputs.length) throw new Error('OpenRouter returned no images');
      const usage = res.usage as Record<string, unknown> | undefined;
      return { outputs, costUsd: numberOrUndefined(usage?.cost) };
    }

    const frames: unknown[] = [];
    if (req.firstFrame && schema.slots.firstFrame) {
      frames.push({ ...((await encodeImage(req.firstFrame, 'content-part')) as object), frame_type: 'first_frame' });
    }
    if (req.lastFrame && schema.slots.lastFrame) {
      frames.push({ ...((await encodeImage(req.lastFrame, 'content-part')) as object), frame_type: 'last_frame' });
    }
    if (frames.length) body.frame_images = frames;
    req.onStatus('Submitting');
    const submit = await requestJson<{ id: string; polling_url?: string; status: string }>(`${BASE}/videos`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...orHeaders(req.apiKey) },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    const job: RemoteJob = { provider: 'openrouter', id: submit.id, meta: { polling_url: submit.polling_url ?? `${BASE}/videos/${submit.id}` } };
    req.onRemoteJob(job);
    return pollVideo(job, { kind: 'video', apiKey: req.apiKey, signal: req.signal, onStatus: req.onStatus });
  },

  resume(job, ctx) {
    return pollVideo(job, ctx);
  },
};

async function pollVideo(job: RemoteJob, ctx: ResumeContext): Promise<GenResult> {
  const started = Date.now();
  for (;;) {
    const st = await requestJson<{ status: string; error?: string; unsigned_urls?: string[]; usage?: { cost?: number | null } }>(job.meta.polling_url, {
      headers: orHeaders(ctx.apiKey),
      signal: ctx.signal,
    });
    if (st.status === 'completed') {
      const n = Math.max(1, st.unsigned_urls?.length ?? 1);
      const outputs = [];
      for (let i = 0; i < n; i++) {
        try {
          const blob = await fetchBlob(`${BASE}/videos/${job.id}/content?index=${i}`, { headers: orHeaders(ctx.apiKey), signal: ctx.signal });
          outputs.push({ blob, mime: blob.type || 'video/mp4' });
        } catch (err) {
          const url = st.unsigned_urls?.[i];
          if (!url) throw err;
          outputs.push({ url, mime: 'video/mp4' });
        }
      }
      return { outputs, costUsd: numberOrUndefined(st.usage?.cost) };
    }
    if (st.status === 'failed' || st.status === 'cancelled' || st.status === 'expired') {
      throw new HttpError(500, st.error || `Video job ${st.status}`, st);
    }
    const elapsed = Math.round((Date.now() - started) / 1000);
    ctx.onStatus(st.status === 'pending' ? `Queued · ${elapsed}s` : `Rendering · ${elapsed}s`);
    await sleep(5000, ctx.signal);
  }
}
