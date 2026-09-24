import { cacheDb } from '../../lib/idb';
import { fetchJsonWithRelay, HttpError, requestJson, sleep } from '../../lib/http';
import { fetchBlob } from '../../lib/media';
import { schemaFromJson, wireParams, type JsonProp } from '../params';
import type { ModelSchema, ModelSummary, PriceRule, RemoteJob } from '../types';
import { encodeImage, extractOutputs, JSON_HEADERS, numberOrUndefined } from './shared';
import type { GenOutput, GenRequest, GenResult, MediaInput, ProviderAdapter, ResumeContext } from './types';
import { modelRef } from './types';

const BASE = 'https://api.atlascloud.ai';
const STATIC = 'https://static.atlascloud.ai';
const DAY = 24 * 3600 * 1000;

interface AtlasModel {
  model: string;
  type: string;
  displayName?: string;
  profile?: string;
  schema?: string;
  categories?: string[];
  display_console?: boolean;
  price?: { actual?: { base_price?: string } };
}

const raws = new Map<string, AtlasModel>();

async function fetchCatalog(): Promise<AtlasModel[]> {
  const cached = await cacheDb.get<AtlasModel[]>('atlas:models', DAY / 2);
  if (cached) return cached;
  const res = await requestJson<{ data: AtlasModel[] }>(`${BASE}/api/v1/models`);
  const media = res.data.filter((m) => m.type === 'Image' || m.type === 'Video');
  await cacheDb.set('atlas:models', media);
  return media;
}

function atlasPrice(m: AtlasModel): PriceRule | undefined {
  const base = numberOrUndefined(m.price?.actual?.base_price);
  if (base == null) return undefined;
  if (m.type === 'Video') {
    return { skus: [{ unit: 'second', usd: base }], approximate: true, note: 'Atlas base price per output second' };
  }
  return { skus: [{ unit: 'output', usd: base }] };
}

export const atlas: ProviderAdapter = {
  id: 'atlas',
  label: 'Atlas Cloud',

  async listModels() {
    const models = await fetchCatalog();
    const out: ModelSummary[] = [];
    for (const m of models) {
      const cats = (m.categories ?? []).map((c) => c.toUpperCase());
      const kind = m.type === 'Video' ? 'video' : 'image';
      const text = cats.includes(kind === 'video' ? 'TEXT-TO-VIDEO' : 'TEXT-TO-IMAGE');
      const image = kind === 'video' ? cats.includes('IMAGE-TO-VIDEO') : cats.includes('IMAGE-TO-IMAGE');
      const tool = kind === 'image' && cats.includes('IMAGE-TOOLS');
      // Skip 3D, video-to-video and audio-driven models: they need inputs/outputs we do not handle.
      if (!text && !image && !tool) continue;
      raws.set(m.model, m);
      const tags: string[] = [];
      if (/upscal/i.test(m.model)) tags.push('upscale');
      if (/remove-background|background-removal|rmbg/i.test(m.model)) tags.push('background-removal');
      out.push({
        ref: modelRef('atlas', m.model),
        provider: 'atlas',
        id: m.model,
        name: m.displayName ?? m.model,
        kind,
        acceptsText: text,
        acceptsImage: image || tool,
        tags,
        description: m.profile,
        price: atlasPrice(m),
      });
    }
    return out;
  },

  async loadSchema(model) {
    const cacheKey = `atlas:schema:${model.id}`;
    const cached = await cacheDb.get<ModelSchema>(cacheKey, DAY);
    if (cached) return { ...cached, price: model.price ?? cached.price };
    if (!raws.has(model.id)) await atlas.listModels(undefined);
    const raw = raws.get(model.id);
    if (!raw?.schema) throw new Error(`Atlas Cloud has no schema for ${model.id}`);
    const path = raw.schema.startsWith(STATIC) ? raw.schema.slice(STATIC.length) : new URL(raw.schema).pathname;
    const doc = await fetchJsonWithRelay<{ components?: { schemas?: Record<string, JsonProp & { properties?: Record<string, JsonProp>; required?: string[] }> } }>(
      raw.schema,
      `/x/atlas-static${path}`,
    );
    const schemas = doc.components?.schemas ?? {};
    const input = schemas.Input ?? Object.entries(schemas).find(([k]) => /input/i.test(k))?.[1];
    if (!input?.properties) throw new Error(`Atlas Cloud schema for ${model.id} has no input definition`);
    const schema = schemaFromJson({
      ref: model.ref,
      kind: model.kind,
      properties: input.properties,
      required: input.required ?? [],
      resolve: (ref) => schemas[ref.split('/').pop() ?? ''],
      imageFormat: 'url',
      source: 'openapi',
    });
    schema.price = model.price;
    await cacheDb.set(cacheKey, schema);
    return schema;
  },

  async generate(req: GenRequest): Promise<GenResult> {
    const { schema } = req;
    const body: Record<string, unknown> = { model: req.model.id, ...wireParams(schema, req.settings, req.count) };
    if (req.prompt && schema.slots.prompt) body[schema.slots.prompt] = req.prompt;
    const upload = (blob: Blob) => uploadMedia(blob, req.apiKey, req.signal);
    const put = async (slot: { key: string; multiple?: boolean; max?: number } | undefined, inputs: MediaInput[]) => {
      if (!slot || !inputs.length) return;
      req.onStatus('Uploading inputs');
      const urls = await Promise.all(inputs.slice(0, slot.max ?? 1).map((i) => encodeImage(i, 'url', upload)));
      body[slot.key] = slot.multiple ? urls : urls[0];
    };
    if (req.kind === 'image') {
      await put(schema.slots.images, req.refs);
    } else {
      await put(schema.slots.firstFrame, req.firstFrame ? [req.firstFrame] : []);
      await put(schema.slots.lastFrame, req.lastFrame ? [req.lastFrame] : []);
      await put(schema.slots.images, req.refs);
    }
    req.onStatus('Submitting');
    const endpoint = req.kind === 'image' ? 'generateImage' : 'generateVideo';
    const submit = await requestJson<{ data?: { id?: string } }>(`${BASE}/api/v1/model/${endpoint}`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, Authorization: `Bearer ${req.apiKey}` },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    const id = submit.data?.id;
    if (!id) throw new Error('Atlas Cloud did not return a prediction id');
    const job: RemoteJob = { provider: 'atlas', id, meta: {} };
    req.onRemoteJob(job);
    return poll(job, { kind: req.kind, apiKey: req.apiKey, signal: req.signal, onStatus: req.onStatus });
  },

  resume(job, ctx) {
    return poll(job, ctx);
  },
};

async function uploadMedia(blob: Blob, apiKey: string, signal: AbortSignal): Promise<string> {
  const form = new FormData();
  const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
  form.append('file', blob, `input.${ext}`);
  const res = await requestJson<Record<string, unknown>>(`${BASE}/api/v1/model/uploadMedia`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal,
  });
  const data = (res.data ?? {}) as Record<string, unknown>;
  const url = res.url ?? data.url ?? data.download_url ?? data.file_url;
  if (typeof url !== 'string') throw new Error('Atlas Cloud upload returned no URL');
  return url;
}

async function poll(job: RemoteJob, ctx: ResumeContext): Promise<GenResult> {
  const started = Date.now();
  const interval = ctx.kind === 'image' ? 2000 : 5000;
  for (;;) {
    const res = await requestJson<{ data?: { status?: string; error?: string | null; outputs?: string[] } }>(
      `${BASE}/api/v1/model/prediction/${encodeURIComponent(job.id)}`,
      { headers: { Authorization: `Bearer ${ctx.apiKey}` }, signal: ctx.signal },
    );
    const status = String(res.data?.status ?? '').toLowerCase();
    if (status === 'completed' || status === 'succeeded') {
      const outputs = await Promise.all(
        extractOutputs(res, ctx.kind).map(async (o): Promise<GenOutput> => {
          if (!o.url) return o;
          try {
            return { blob: await fetchBlob(o.url, { signal: ctx.signal }), mime: o.mime };
          } catch {
            return o;
          }
        }),
      );
      if (!outputs.length) throw new Error('Atlas Cloud finished without outputs');
      return { outputs };
    }
    if (status === 'failed' || status === 'canceled' || status === 'cancelled') {
      throw new HttpError(500, res.data?.error || 'Generation failed', res);
    }
    const elapsed = Math.round((Date.now() - started) / 1000);
    ctx.onStatus(`${status === 'processing' ? 'Rendering' : 'Queued'} · ${elapsed}s`);
    await sleep(interval, ctx.signal);
  }
}
