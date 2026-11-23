import { extractErrorMessage, fetchJsonWithRelay, isAbort, JobFailedError, requestJson } from '../../lib/http';
import { fetchBlob } from '../../lib/media';
import { schemaFromJson, wireParams, type JsonProp } from '../params';
import type { GenSettings, ModelSchema, ModelSummary, PriceRule, RemoteJob } from '../types';
import { cachedJson, encodeImage, encodeVideo, extractOutputs, JSON_HEADERS, keyedUrl, numberOrUndefined, POLL_TIMEOUT_MS, pollJob, resolveBody, splitSource, structuredInputs } from './shared';
import type { GenBuildRequest, GenOutput, GenRequest, GenResult, MediaInput, PreparedRequest, ProviderAdapter, RequestEncoder, ResumeContext } from './types';
import { modelRef } from './types';
import { takesSourceAsReference } from '../modelRules';
import { modelMime } from '../../lib/model3d';

const BASE = 'https://api.atlascloud.ai';
const STATIC = 'https://static.atlascloud.ai';
const DAY = 24 * 3600 * 1000;
/** Waits before trying a refused Atlas request again (then the error stands). */
const ATLAS_RETRY_MS = 5_000;
export const ATLAS_RETRY_WAITS = [ATLAS_RETRY_MS, 20_000, 60_000];

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
  // v3: the chosen 3D models too (listed by Atlas as type Image).
  return (await cachedJson<AtlasModel[]>('atlas:models:v3', DAY / 2, async () => {
    const res = await requestJson<{ data: AtlasModel[] }>(`${BASE}/api/v1/models`);
    return res.data.filter((m) => m.type === 'Image' || m.type === 'Video' || (m.type === 'Audio' && AUDIO_FAMILIES.test(m.model)));
  }))!;
}

/** Audio families confirmed by the user (2026-09-25): MiniMax Music and MiniMax Lyrics. Others wait for a decision. */
const AUDIO_FAMILIES = /^minimax\/(music|lyrics)/;

/**
 * 3D models chosen by the user (2026-09-25): Tripo H3.1 and Seed3D 2.0. Meshy v7 and older Tripo versions are
 * not substitutes. Seed3D answers at /model/result/{id} with a ZIP; Tripo at /model/prediction/{id} with files.
 */
export const MODEL3D_FAMILIES = /^(tripo-h3\.1\/(text|image)-to-3d|bytedance\/seed3d-v2\.0\/image-to-3d)$/;

function atlasPrice(m: AtlasModel): PriceRule | undefined {
  const base = numberOrUndefined(m.price?.actual?.base_price);
  if (base == null) return undefined;
  if ((m.categories ?? []).some((c) => /-TO-3D$/i.test(c))) {
    // base_price is the default configuration; face count, quads or detailed quality may cost more.
    return { skus: [{ unit: 'output', usd: base }], approximate: true, lowerBound: true, note: 'Atlas base price per model (default options); detailed quality or extras may cost more' };
  }
  if (m.type === 'Video') {
    // Atlas publishes only the cheapest tier (lowest resolution, no audio); real runs at 720p cost ~2× (seen: 0.055 → 0.122 USD).
    return { skus: [{ unit: 'second', usd: base }], approximate: true, lowerBound: true, note: 'Atlas base price per second (lowest tier); higher resolution or audio cost more' };
  }
  return { skus: [{ unit: 'output', usd: base }] };
}

/**
 * What an Atlas video endpoint takes. The catalog leaves some categories empty (FLUX 3, several
 * reference-to-video) and files others wrongly (Wan reference under VIDEO-TO-VIDEO, Grok extend under
 * IMAGE-TO-VIDEO), so an explicit task in the endpoint name wins. `video`: needs a source clip to edit.
 * Keyframe and reference-developer endpoints take images / a trimmed clip through their own slots.
 */
export function atlasVideoCaps(id: string, cats: string[]): { text: boolean; image: boolean; video: boolean } | null {
  const task = (id.split('/').pop() ?? '').replace(/-developer$/, '');
  if (task === 'keyframes-to-video') return { text: true, image: true, video: false };
  if (/(edit-video|video-edit|extend-video|video-extend|motion-control)$/.test(task)) return { text: true, image: false, video: true };
  if (task === 'reference-to-video') return { text: true, image: true, video: false };
  if (/(image|frame)-to-video$/.test(task)) return { text: cats.includes('TEXT-TO-VIDEO'), image: true, video: false };
  if (task === 'text-to-video') return { text: true, image: false, video: false };
  // Talking avatars (InfiniteTalk, OmniHuman): a portrait plus a voice track.
  if (cats.includes('AUDIO-TO-VIDEO')) return { text: true, image: true, video: false };
  return { text: cats.includes('TEXT-TO-VIDEO'), image: cats.includes('IMAGE-TO-VIDEO'), video: cats.includes('VIDEO-TO-VIDEO') };
}

// The calculation endpoint quotes the same wire parameters without a key, media or a model run.
const ATLAS_QUOTE_URL = `${BASE}/api/v1/model/calculate`;
const QUOTE_PROMPT = 'price quote';

/** The body Atlas would receive for this request, minus media. */
function atlasQuoteBody(modelId: string, schema: ModelSchema, settings: GenSettings, count = settings.count): Record<string, unknown> {
  const body: Record<string, unknown> = { model: modelId, ...wireParams(schema, settings, Math.max(1, count)) };
  if (schema.slots.prompt) body[schema.slots.prompt] = QUOTE_PROMPT;
  return body;
}

/** `data.price` (or `price`), in USD; null when the answer has none. */
function parseAtlasQuote(json: unknown): number | null {
  const o = (json ?? {}) as { data?: { price?: unknown }; price?: unknown };
  const raw = o.data?.price ?? o.price;
  const n = typeof raw === 'string' ? Number.parseFloat(raw) : typeof raw === 'number' ? raw : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const quote: NonNullable<ProviderAdapter['quote']> = async (model, schema, settings, count, timeoutMs = 3000) => {
  try {
    const res = await fetch(ATLAS_QUOTE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(atlasQuoteBody(model.id, schema, settings, count)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok ? parseAtlasQuote(await res.json()) : null;
  } catch {
    return null;
  }
};

export const atlas: ProviderAdapter = {
  id: 'atlas',
  label: 'Atlas Cloud',

  shortLabel: 'Atlas',
  quote,
  // Developer variants: one request at a time per model, in every canvas (T4).
  serialKey: (model) => (model.id.endsWith('-developer') ? `atlas:${model.id}` : null),
  // Atlas sometimes refuses one request of a batch ("Upstream access denied") and accepts it later.
  retry: { waits: ATLAS_RETRY_WAITS, matches: (message) => /upstream access denied/i.test(message), label: 'Atlas', reason: 'Upstream access denied' },

  async listModels() {
    const models = await fetchCatalog();
    const out: ModelSummary[] = [];
    for (const m of models) {
      const cats = (m.categories ?? []).map((c) => c.toUpperCase());
      if (m.type === 'Audio') {
        if (!cats.includes('TEXT-TO-AUDIO')) continue;
        raws.set(m.model, m);
        out.push({
          ref: modelRef('atlas', m.model),
          provider: 'atlas',
          id: m.model,
          name: m.displayName ?? m.model,
          kind: 'audio',
          acceptsText: true,
          acceptsImage: false,
          tags: [],
          ...(/lyrics/.test(m.model) ? { textOutput: true } : {}),
          description: m.profile,
          price: atlasPrice(m),
        });
        continue;
      }
      if (cats.some((c) => c.endsWith('-TO-3D'))) {
        if (!MODEL3D_FAMILIES.test(m.model)) continue;
        raws.set(m.model, m);
        out.push({
          ref: modelRef('atlas', m.model),
          provider: 'atlas',
          id: m.model,
          name: m.displayName ?? m.model,
          kind: 'model3d',
          acceptsText: cats.includes('TEXT-TO-3D'),
          acceptsImage: cats.includes('IMAGE-TO-3D'),
          tags: [],
          description: m.profile,
          price: atlasPrice(m),
        });
        continue;
      }
      const kind = m.type === 'Video' ? 'video' : 'image';
      let text = cats.includes(kind === 'video' ? 'TEXT-TO-VIDEO' : 'TEXT-TO-IMAGE');
      let image = kind === 'video' ? cats.includes('IMAGE-TO-VIDEO') : cats.includes('IMAGE-TO-IMAGE');
      const tool = kind === 'image' && cats.includes('IMAGE-TOOLS');
      let video = false;
      if (kind === 'video') {
        const caps = atlasVideoCaps(m.model, cats);
        if (!caps) continue;
        ({ text, image, video } = caps);
      }
      // Skip 3D and audio-driven models: they need inputs/outputs we do not handle.
      if (!text && !image && !tool && !video) continue;
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
        acceptsImage: (image || tool) && !video,
        acceptsVideo: video || takesSourceAsReference(m.model),
        needsVideo: video,
        tags,
        description: m.profile,
        price: atlasPrice(m),
      });
    }
    return out;
  },

  async loadSchema(model) {
    // v3: reference slots, fixed/missing required fields, sizes as framing.
    const cacheKey = `atlas:schema:v4:${model.id}`;
    const schema = (await cachedJson<ModelSchema>(cacheKey, DAY, async () => {
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
      const built = schemaFromJson({
        ref: model.ref,
        kind: model.kind,
        properties: input.properties,
        required: input.required ?? [],
        resolve: (ref) => schemas[ref.split('/').pop() ?? ''],
        imageFormat: 'url',
        source: 'openapi',
      });
      built.price = model.price;
      return built;
    }))!;
    return { ...schema, price: model.price ?? schema.price };
  },

  buildRequest(req: GenBuildRequest, enc: RequestEncoder): PreparedRequest {
    const { schema } = req;
    const body: Record<string, unknown> = { model: req.model.id, ...wireParams(schema, req.settings, req.count) };
    if (req.prompt && schema.slots.prompt) body[schema.slots.prompt] = req.prompt;
    const put = (slot: { key: string; multiple?: boolean; max?: number } | undefined, inputs: MediaInput[]) => {
      if (!slot || !inputs.length) return;
      const urls = inputs.slice(0, slot.max ?? 1).map((i) => enc.image(i, 'url'));
      body[slot.key] = slot.multiple ? urls : urls[0];
    };
    if (req.kind === 'model3d') {
      put(schema.slots.images, req.refs);
      if ('file_format' in body || /seed3d/.test(req.model.id)) body.file_format ??= 'glb';
    } else if (req.kind === 'image') {
      const { source, refs } = splitSource(schema.slots, req.refs);
      if (source && schema.slots.source) body[schema.slots.source.key] = enc.image(source, 'url');
      put(schema.slots.images, refs);
    } else {
      put(schema.slots.firstFrame, req.firstFrame ? [req.firstFrame] : []);
      put(schema.slots.lastFrame, req.lastFrame ? [req.lastFrame] : []);
      put(schema.slots.images, req.refs);
      const refVideos = req.refVideos ?? [];
      if (schema.slots.refVideos && refVideos.length) body[schema.slots.refVideos.key] = refVideos.slice(0, schema.slots.refVideos.max).map((v) => enc.video(v));
      if (schema.slots.mixedRefs) {
        const items = [...req.refs.map((input) => ({ input, type: 'image' as const })), ...refVideos.map((input) => ({ input, type: 'video' as const })), ...(req.refAudios ?? []).map((input) => ({ input, type: 'audio' as const }))];
        if (items.length) body[schema.slots.mixedRefs.key] = items.slice(0, schema.slots.mixedRefs.max).map(({ input, type }) => ({ url: type === 'image' ? enc.image(input, 'url') : enc.video(input), type }));
      }
      if (req.video && schema.slots.video) body[schema.slots.video.key] = enc.video(req.video);
    }
    if (req.keyframes?.length || req.clips?.length || req.audio || req.refAudios?.length || req.elements?.length || req.mask) {
      Object.assign(body, structuredInputs(schema.slots, req, (i) => enc.image(i, 'url'), (v) => enc.video(v)));
    }
    const endpoint = req.kind === 'image' || req.kind === 'model3d' ? 'generateImage' : req.kind === 'audio' ? 'generateAudio' : 'generateVideo';
    return { url: `${BASE}/api/v1/model/${endpoint}`, body };
  },

  async generate(req: GenRequest): Promise<GenResult> {
    const upload = (blob: Blob) => { req.onStatus('Uploading inputs'); return uploadMedia(blob, req.apiKey, req.signal); };
    const raw = atlas.buildRequest!(req, { image: (i, fmt) => encodeImage(i, fmt, upload), video: (v) => encodeVideo(v, upload) });
    const body = await resolveBody(raw.body);
    req.onStatus('Submitting');
    req.onRequest?.({ url: raw.url, body });
    const submit = await requestJson<{ data?: { id?: string; urls?: { get?: string } } }>(raw.url, {
      method: 'POST',
      headers: { ...JSON_HEADERS, Authorization: `Bearer ${req.apiKey}` },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    const id = submit.data?.id;
    if (!id) throw new Error('Atlas Cloud did not return a prediction id');
    const get = submit.data?.urls?.get;
    const pollUrl = get?.startsWith(`${BASE}/`) ? get : /seed3d/.test(req.model.id) ? `${BASE}/api/v1/model/result/${encodeURIComponent(id)}` : undefined;
    const job: RemoteJob = { provider: 'atlas', id, meta: pollUrl ? { pollUrl } : {} };
    req.onRemoteJob(job);
    return poll(job, { kind: req.model.textOutput ? 'text' : req.kind, apiKey: req.apiKey, signal: req.signal, onStatus: req.onStatus });
  },

  async balance(apiKey, signal) {
    // Billing lives under /public/v1 (same endpoint the official atlascloud-mcp uses).
    const res = await requestJson<{ available?: { value?: string } }>(`${BASE}/public/v1/balance`, { headers: { Authorization: `Bearer ${apiKey}` }, signal });
    return numberOrUndefined(res.available?.value);
  },

  resume(job, ctx) {
    return poll(job, ctx);
  },
};

async function uploadMedia(blob: Blob, apiKey: string, signal: AbortSignal): Promise<string> {
  const form = new FormData();
  const ext = blob.type.split('/')[1]?.replace('quicktime', 'mov').replace('jpeg', 'jpg').split(';')[0] || 'bin';
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

function poll(job: RemoteJob, ctx: ResumeContext): Promise<GenResult> {
  const kind = ctx.kind === 'text' ? 'audio' : ctx.kind; // text jobs are lyrics (audio models)
  // "completed" can arrive before the files are listed: ask again a few times before calling the job empty.
  let emptyAnswers = 0;
  return pollJob(ctx, 'Atlas Cloud', ctx.kind === 'image' || ctx.kind === 'text' ? 2000 : 5000, async () => {
    const res = await requestJson<{ data?: { status?: string; error?: unknown; outputs?: string[] | null; files?: AtlasFile[]; thumbnail?: string; lyrics_result?: LyricsResult | null } }>(
      job.meta.pollUrl ? keyedUrl(job.meta.pollUrl, BASE, 'Atlas Cloud') : `${BASE}/api/v1/model/prediction/${encodeURIComponent(job.id)}`,
      { headers: { Authorization: `Bearer ${ctx.apiKey}` }, signal: ctx.signal, timeoutMs: POLL_TIMEOUT_MS },
    );
    const status = String(res.data?.status ?? '').toLowerCase();
    if (status === 'completed' || status === 'succeeded') {
      if (ctx.kind === 'text') {
        const lyrics = res.data?.lyrics_result;
        if (!lyrics?.lyrics) throw new JobFailedError('Atlas Cloud finished without lyrics');
        return { outputs: [], text: lyricsText(lyrics) };
      }
      const found = kind === 'model3d' ? atlasModelOutputs(res.data ?? {}) : extractOutputs(res, kind);
      ctx.onStatus('Downloading result');
      const outputs = await Promise.all(
        found.map(async (o): Promise<GenOutput> => {
          if (!o.url) return o;
          try {
            return { blob: await fetchBlob(o.url, { signal: ctx.signal }), mime: o.mime };
          } catch (err) {
            if (isAbort(err)) throw err;
            return o;
          }
        }),
      );
      if (!outputs.length) {
        if (++emptyAnswers <= 3) return 'Finishing';
        throw new JobFailedError('Atlas Cloud finished without outputs');
      }
      return { outputs };
    }
    if (status === 'failed' || status === 'canceled' || status === 'cancelled') {
      // Keep Atlas's own error code with the message (e.g. 1013002 "Upstream access denied"): it tells a refusal by
      // the upstream model from a quota or account problem when the log is read later.
      const raw = res.data as { error_code?: unknown; code?: unknown } | undefined;
      const code = raw?.error_code ?? raw?.code;
      const msg = extractErrorMessage(res.data, 'Generation failed');
      throw new JobFailedError(code != null && code !== '' ? `${msg} [Atlas code ${String(code)}]` : msg);
    }
    return status === 'processing' ? 'Rendering' : 'Queued';
  });
}

interface AtlasFile {
  url?: string;
  type?: string;
  content_type?: string;
  file_name?: string;
}

/**
 * Tripo lists model files (GLB, FBX with quads, variants) in `files` and a preview render in `thumbnail`
 * (also last in `outputs`); Seed3D has only `outputs` with one ZIP. The render is marked as an image so it
 * becomes the model's thumbnail, never a model. The bytes decide the final type (`sniffModelMime`).
 */
export function atlasModelOutputs(data: { outputs?: string[] | null; files?: AtlasFile[]; thumbnail?: string }): GenOutput[] {
  const out: GenOutput[] = [];
  const seen = new Set<string>();
  const add = (url: string | undefined, mime: string | undefined) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ url, mime });
  };
  for (const f of data.files ?? []) add(f.url, f.content_type || modelMime(f.file_name ?? f.url ?? '') || (/^(image|preview|thumbnail)$/i.test(f.type ?? '') ? 'image/png' : undefined));
  if (data.thumbnail) add(data.thumbnail, 'image/png');
  for (const u of data.outputs ?? []) add(u, modelMime(u) ?? (/\.(png|jpe?g|webp)(\?|$)/i.test(u) ? 'image/png' : undefined));
  return out;
}

interface LyricsResult {
  song_title?: string;
  style_tags?: string[];
  lyrics?: string;
}

/**
 * MiniMax Lyrics result as one text: "# Title", "Style: tags", then the lyrics. `lyricsBody` (params.ts) gives
 * back what the music models take.
 */
export function lyricsText(r: LyricsResult): string {
  const head = [r.song_title ? `# ${r.song_title}` : '', r.style_tags?.length ? `Style: ${r.style_tags.join(', ')}` : ''].filter(Boolean);
  return [...head, ...(head.length ? [''] : []), r.lyrics ?? ''].join('\n');
}

