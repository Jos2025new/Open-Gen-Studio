import { cacheDb } from '../../lib/idb';
import { fetchJsonWithRelay, requestJson, sleep } from '../../lib/http';
import { fetchBlob } from '../../lib/media';
import { schemaFromJson, wireParams, type JsonProp } from '../params';
import type { MediaKind, ModelSchema, ModelSummary, PriceRule, RemoteJob } from '../types';
import { encodeImage, extractOutputs, JSON_HEADERS } from './shared';
import type { GenOutput, GenRequest, GenResult, MediaInput, ProviderAdapter, ResumeContext } from './types';
import { modelRef } from './types';

const API = 'https://api.fal.ai/v1';
const QUEUE = 'https://queue.fal.run';
const DAY = 24 * 3600 * 1000;

const CATEGORIES: Array<{ category: string; kind: MediaKind; text: boolean; image: boolean; suffix: string }> = [
  { category: 'text-to-image', kind: 'image', text: true, image: false, suffix: '' },
  { category: 'image-to-image', kind: 'image', text: true, image: true, suffix: ' · Edit' },
  { category: 'text-to-video', kind: 'video', text: true, image: false, suffix: '' },
  { category: 'image-to-video', kind: 'video', text: true, image: true, suffix: ' · I2V' },
];

interface FalModel {
  endpoint_id: string;
  metadata?: { display_name?: string; category?: string; description?: string; status?: string; tags?: string[] };
}

function falHeaders(key: string): Record<string, string> {
  return { Authorization: `Key ${key}` };
}

async function fetchCategory(category: string): Promise<FalModel[]> {
  const cacheKey = `fal:models:${category}`;
  const cached = await cacheDb.get<FalModel[]>(cacheKey, DAY / 2);
  if (cached) return cached;
  const all: FalModel[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 3; page++) {
    const url = `${API}/models?category=${category}&status=active&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res: { models: FalModel[]; next_cursor?: string | null; has_more?: boolean } = await requestJson(url);
    all.push(...res.models);
    if (!res.has_more || !res.next_cursor) break;
    cursor = res.next_cursor;
  }
  await cacheDb.set(cacheKey, all);
  return all;
}

function toolTags(id: string): string[] {
  const tags: string[] = [];
  if (/upscal/i.test(id)) tags.push('upscale');
  if (/background[-/]remov|remove[-/]background|birefnet|rmbg|background-removal/i.test(id)) tags.push('background-removal');
  return tags;
}

async function falPrice(id: string, apiKey: string | undefined): Promise<PriceRule | undefined> {
  if (!apiKey) return undefined;
  const cacheKey = `fal:price:${id}`;
  const cached = await cacheDb.get<PriceRule>(cacheKey, DAY);
  if (cached) return cached;
  try {
    const res = await requestJson<{ prices?: Array<{ endpoint_id: string; unit_price: number; unit: string }> }>(
      `${API}/models/pricing?endpoint_id=${encodeURIComponent(id)}`,
      { headers: falHeaders(apiKey) },
    );
    const p = res.prices?.find((x) => x.endpoint_id === id) ?? res.prices?.[0];
    if (!p || !Number.isFinite(p.unit_price)) return undefined;
    const unit = p.unit.toLowerCase();
    let rule: PriceRule;
    if (/^(image|images|video|videos|generation|generations|request|requests)$/.test(unit)) {
      rule = { skus: [{ unit: 'output', usd: p.unit_price }] };
    } else if (/^seconds?$/.test(unit) || unit === 'video_seconds') {
      rule = { skus: [{ unit: 'second', usd: p.unit_price }] };
    } else if (/megapixel/.test(unit)) {
      rule = { skus: [{ unit: 'megapixel', usd: p.unit_price }] };
    } else {
      rule = { skus: [], note: `Billed per ${p.unit.replace(/_/g, ' ')} ($${p.unit_price})` };
    }
    await cacheDb.set(cacheKey, rule);
    return rule;
  } catch {
    return undefined;
  }
}

export const fal: ProviderAdapter = {
  id: 'fal',
  label: 'fal.ai',

  async listModels() {
    const out: ModelSummary[] = [];
    const seen = new Set<string>();
    const lists = await Promise.all(CATEGORIES.map((c) => fetchCategory(c.category).then((models) => ({ c, models }))));
    for (const { c, models } of lists) {
      for (const m of models) {
        if (seen.has(m.endpoint_id) || (m.metadata?.status && m.metadata.status !== 'active')) continue;
        seen.add(m.endpoint_id);
        const tags = toolTags(m.endpoint_id);
        out.push({
          ref: modelRef('fal', m.endpoint_id),
          provider: 'fal',
          id: m.endpoint_id,
          name: `${m.metadata?.display_name ?? m.endpoint_id}${c.suffix}`,
          kind: c.kind,
          acceptsText: c.text && !tags.length,
          acceptsImage: c.image,
          tags,
          description: m.metadata?.description,
        });
      }
    }
    return out;
  },

  async loadSchema(model, apiKey) {
    const cacheKey = `fal:schema:${model.id}`;
    let schema = await cacheDb.get<ModelSchema>(cacheKey, DAY);
    if (!schema) {
      const qs = `endpoint_id=${encodeURIComponent(model.id)}`;
      const doc = await fetchJsonWithRelay<{
        paths?: Record<string, { post?: { requestBody?: { content?: Record<string, { schema?: JsonProp }> } } }>;
        components?: { schemas?: Record<string, JsonProp & { properties?: Record<string, JsonProp>; required?: string[] }> };
      }>(`https://fal.ai/api/openapi/queue/openapi.json?${qs}`, `/x/fal-web/api/openapi/queue/openapi.json?${qs}`);
      const schemas = doc.components?.schemas ?? {};
      const resolve = (ref: string) => schemas[ref.split('/').pop() ?? ''];
      const post = doc.paths?.[`/${model.id}`]?.post;
      const inputRef = post?.requestBody?.content?.['application/json']?.schema?.$ref;
      const input = (inputRef ? resolve(inputRef) : undefined) ?? Object.entries(schemas).find(([k]) => /Input$/.test(k))?.[1];
      if (!input?.properties) throw new Error(`fal.ai schema for ${model.id} has no input definition`);
      schema = schemaFromJson({
        ref: model.ref,
        kind: model.kind,
        properties: input.properties as Record<string, JsonProp>,
        required: (input as { required?: string[] }).required ?? [],
        resolve,
        imageFormat: 'data-url',
        source: 'openapi',
      });
      await cacheDb.set(cacheKey, schema);
    }
    const price = await falPrice(model.id, apiKey);
    return { ...schema, price: price ?? schema.price };
  },

  async generate(req: GenRequest): Promise<GenResult> {
    const { schema } = req;
    const body: Record<string, unknown> = wireParams(schema, req.settings, req.count);
    if (req.prompt && schema.slots.prompt) body[schema.slots.prompt] = req.prompt;
    const put = async (slot: { key: string; multiple?: boolean; max?: number } | undefined, inputs: MediaInput[]) => {
      if (!slot || !inputs.length) return;
      const encoded = await Promise.all(inputs.slice(0, slot.max ?? 1).map((i) => encodeImage(i, 'data-url')));
      body[slot.key] = slot.multiple ? encoded : encoded[0];
    };
    if (req.kind === 'image') await put(schema.slots.images, req.refs);
    else {
      await put(schema.slots.firstFrame, req.firstFrame ? [req.firstFrame] : []);
      await put(schema.slots.lastFrame, req.lastFrame ? [req.lastFrame] : []);
      await put(schema.slots.images, req.refs);
    }
    req.onStatus('Submitting');
    const submit = await requestJson<{ request_id: string; status_url?: string; response_url?: string }>(`${QUEUE}/${req.model.id}`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...falHeaders(req.apiKey) },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    const base = `${QUEUE}/${req.model.id.split('/').slice(0, 2).join('/')}/requests/${submit.request_id}`;
    const job: RemoteJob = {
      provider: 'fal',
      id: submit.request_id,
      meta: { status_url: submit.status_url ?? `${base}/status`, response_url: submit.response_url ?? base },
    };
    req.onRemoteJob(job);
    return poll(job, { kind: req.kind, apiKey: req.apiKey, signal: req.signal, onStatus: req.onStatus });
  },

  resume(job, ctx) {
    return poll(job, ctx);
  },
};

async function poll(job: RemoteJob, ctx: ResumeContext): Promise<GenResult> {
  const started = Date.now();
  const interval = ctx.kind === 'image' ? 1500 : 4000;
  for (;;) {
    const st = await requestJson<{ status: string; queue_position?: number }>(job.meta.status_url, {
      headers: falHeaders(ctx.apiKey),
      signal: ctx.signal,
    });
    if (st.status === 'COMPLETED') {
      const res = await requestJson<unknown>(job.meta.response_url, { headers: falHeaders(ctx.apiKey), signal: ctx.signal });
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
      if (!outputs.length) throw new Error('fal.ai finished without outputs');
      return { outputs };
    }
    const elapsed = Math.round((Date.now() - started) / 1000);
    ctx.onStatus(st.status === 'IN_QUEUE' ? `Queued${st.queue_position != null ? ` #${st.queue_position + 1}` : ''} · ${elapsed}s` : `Rendering · ${elapsed}s`);
    await sleep(interval, ctx.signal);
  }
}
