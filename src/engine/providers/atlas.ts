import { cacheDb } from '../../lib/idb';
import { extractErrorMessage, fetchJsonWithRelay, JobFailedError, requestJson } from '../../lib/http';
import { fetchBlob } from '../../lib/media';
import { schemaFromJson, wireParams, type JsonProp } from '../params';
import type { ModelSchema, ModelSummary, PriceRule, RemoteJob } from '../types';
import { encodeImage, encodeVideo, extractOutputs, JSON_HEADERS, numberOrUndefined, POLL_TIMEOUT_MS, pollJob, splitSource, structuredInputs } from './shared';
import type { GenOutput, GenRequest, GenResult, MediaInput, ProviderAdapter, ResumeContext } from './types';
import { modelRef } from './types';
import { takesSourceAsReference } from '../modelRules';

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
  // v2: audio models too.
  const cached = await cacheDb.get<AtlasModel[]>('atlas:models:v2', DAY / 2);
  if (cached) return cached;
  const res = await requestJson<{ data: AtlasModel[] }>(`${BASE}/api/v1/models`);
  const media = res.data.filter((m) => m.type === 'Image' || m.type === 'Video' || (m.type === 'Audio' && AUDIO_FAMILIES.test(m.model)));
  await cacheDb.set('atlas:models:v2', media);
  return media;
}

/** Audio families confirmed by the user (2026-09-25): MiniMax Music and MiniMax Lyrics. Others wait for a decision. */
const AUDIO_FAMILIES = /^minimax\/(music|lyrics)/;

function atlasPrice(m: AtlasModel): PriceRule | undefined {
  const base = numberOrUndefined(m.price?.actual?.base_price);
  if (base == null) return undefined;
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

export const atlas: ProviderAdapter = {
  id: 'atlas',
  label: 'Atlas Cloud',

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
    const cacheKey = `atlas:schema:v3:${model.id}`;
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
      const { source, refs } = splitSource(schema.slots, req.refs);
      if (source && schema.slots.source) body[schema.slots.source.key] = await encodeImage(source, 'url', upload);
      await put(schema.slots.images, refs);
    } else {
      await put(schema.slots.firstFrame, req.firstFrame ? [req.firstFrame] : []);
      await put(schema.slots.lastFrame, req.lastFrame ? [req.lastFrame] : []);
      await put(schema.slots.images, req.refs);
      const refVideos = req.refVideos ?? [];
      if (schema.slots.refVideos && refVideos.length) {
        req.onStatus('Uploading references');
        body[schema.slots.refVideos.key] = await Promise.all(refVideos.slice(0, schema.slots.refVideos.max).map((v) => encodeVideo(v, upload)));
      }
      if (schema.slots.mixedRefs) {
        // `refers`: one list of { url, type } for images and videos.
        const items = [
          ...req.refs.map((input) => ({ input, type: 'image' as const })),
          ...refVideos.map((input) => ({ input, type: 'video' as const })),
          ...(req.refAudios ?? []).map((input) => ({ input, type: 'audio' as const })),
        ];
        if (items.length) {
          req.onStatus('Uploading references');
          body[schema.slots.mixedRefs.key] = await Promise.all(
            items.slice(0, schema.slots.mixedRefs.max).map(async ({ input, type }) => ({ url: type === 'image' ? await encodeImage(input, 'url', upload) : await encodeVideo(input, upload), type })),
          );
        }
      }
      if (req.video && schema.slots.video) {
        req.onStatus('Uploading video');
        body[schema.slots.video.key] = await encodeVideo(req.video, upload);
      }
    }
    if (req.keyframes?.length || req.clips?.length || req.audio || req.refAudios?.length || req.elements?.length || req.mask) {
      req.onStatus('Uploading inputs');
      Object.assign(body, await structuredInputs(schema.slots, req, (i) => encodeImage(i, 'url', upload), (v) => encodeVideo(v, upload)));
    }
    req.onStatus('Submitting');
    const endpoint = req.kind === 'image' ? 'generateImage' : req.kind === 'audio' ? 'generateAudio' : 'generateVideo';
    const submit = await requestJson<{ data?: { id?: string; urls?: { get?: string } } }>(`${BASE}/api/v1/model/${endpoint}`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, Authorization: `Bearer ${req.apiKey}` },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    const id = submit.data?.id;
    if (!id) throw new Error('Atlas Cloud did not return a prediction id');
    // Poll where Atlas says (OmniHuman answers at /model/result/{id}, most models at /model/prediction/{id}).
    const get = submit.data?.urls?.get;
    const job: RemoteJob = { provider: 'atlas', id, meta: get?.startsWith(`${BASE}/`) ? { pollUrl: get } : {} };
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
  return pollJob(ctx, 'Atlas Cloud', ctx.kind === 'image' || ctx.kind === 'text' ? 2000 : 5000, async () => {
    const res = await requestJson<{ data?: { status?: string; error?: unknown; outputs?: string[]; lyrics_result?: LyricsResult | null } }>(
      job.meta.pollUrl ?? `${BASE}/api/v1/model/prediction/${encodeURIComponent(job.id)}`,
      { headers: { Authorization: `Bearer ${ctx.apiKey}` }, signal: ctx.signal, timeoutMs: POLL_TIMEOUT_MS },
    );
    const status = String(res.data?.status ?? '').toLowerCase();
    if (status === 'completed' || status === 'succeeded') {
      if (ctx.kind === 'text') {
        const lyrics = res.data?.lyrics_result;
        if (!lyrics?.lyrics) throw new JobFailedError('Atlas Cloud finished without lyrics');
        return { outputs: [], text: lyricsText(lyrics) };
      }
      const outputs = await Promise.all(
        extractOutputs(res, kind).map(async (o): Promise<GenOutput> => {
          if (!o.url) return o;
          try {
            return { blob: await fetchBlob(o.url, { signal: ctx.signal }), mime: o.mime };
          } catch {
            return o;
          }
        }),
      );
      if (!outputs.length) throw new JobFailedError('Atlas Cloud finished without outputs');
      return { outputs };
    }
    if (status === 'failed' || status === 'canceled' || status === 'cancelled') {
      throw new JobFailedError(extractErrorMessage(res.data, 'Generation failed'));
    }
    return status === 'processing' ? 'Rendering' : 'Queued';
  });
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

