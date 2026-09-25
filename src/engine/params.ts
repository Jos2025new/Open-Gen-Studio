import type {
  AdvancedValue,
  GenSettings,
  ImageInputFormat,
  InputSlots,
  MediaKind,
  ModelSchema,
  ParamDef,
  ParamRole,
} from './types';

// ---------------------------------------------------------------------------
// Key classification

const ROLE_KEYS: Record<Exclude<ParamRole, 'other'>, string[]> = {
  aspect: ['aspect_ratio', 'aspectratio', 'ratio', 'image_size', 'orientation'],
  resolution: ['resolution', 'resolutions', 'size', 'quality_resolution', 'output_resolution'],
  duration: ['duration', 'seconds', 'duration_seconds', 'video_length'],
  // Not max_images: Seedream uses it for multi-image sets next to num_images.
  count: ['n', 'num_images', 'num_outputs', 'nimages', 'number_of_images'],
  audio: ['generate_audio', 'generateaudio', 'sound', 'audio', 'enable_audio', 'with_audio', 'audio_generation'],
  seed: ['seed'],
  negative: ['negative_prompt', 'negativeprompt'],
};

/** Parameters we never surface (transport flags handled by the adapters). */
const HIDDEN_KEYS = new Set([
  'model',
  'sync_mode',
  'enable_sync_mode',
  'enable_base64_output',
  'webhook',
  'webhook_url',
  'callback_url',
  'stream',
  'response_format',
  'conversationuuid',
  'provider',
  'session_id',
  'limit_generations',
]);

const PROMPT_KEYS = ['prompt', 'text', 'instruction'];

const MULTI_IMAGE_KEYS = ['image_urls', 'images', 'input_references', 'reference_images', 'reference_image_urls', 'imagedataurls', 'image_list', 'ref_images'];
const SINGLE_IMAGE_KEYS = ['image_url', 'image', 'input_image', 'imagedataurl', 'init_image', 'source_image', 'image_input'];
const FIRST_FRAME_KEYS = ['start_image_url', 'first_frame_image', 'start_image', 'first_frame', 'first_frame_url', 'image_url', 'image', 'imagedataurl', 'input_image'];
// Source video for edit/upscale models (fal: video_url; Atlas: video or video_url).
const VIDEO_KEYS = ['video_url', 'video', 'input_video', 'source_video', 'video_input'];
// Lists of reference clips (Atlas: reference_videos; fal: video_urls, reference_video_urls).
const REF_VIDEO_KEYS = ['reference_videos', 'reference_video_urls', 'video_urls'];
const LAST_FRAME_KEYS = ['end_image_url', 'last_image', 'tail_image_url', 'end_image', 'last_frame_image', 'last_frame', 'last_frame_url', 'tail_image'];

export function normKey(k: string): string {
  return k.toLowerCase();
}

/**
 * Canonical role of a parameter. An aspect-like key (image_size, orientation...) only
 * counts as 'aspect' when its options read as ratios; otherwise it stays model-specific.
 */
export function roleForKey(key: string, options?: Array<string | number>): ParamRole {
  const k = normKey(key);
  for (const [role, keys] of Object.entries(ROLE_KEYS) as Array<[Exclude<ParamRole, 'other'>, string[]]>) {
    if (!keys.includes(k)) continue;
    if (role === 'aspect' && !options?.some((o) => ratioOf(o) != null)) return 'other';
    return role;
  }
  return 'other';
}

export function isHiddenKey(key: string): boolean {
  return HIDDEN_KEYS.has(normKey(key));
}

export function humanizeKey(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ---------------------------------------------------------------------------
// Aspect helpers

const ASPECT_ALIASES: Record<string, string> = {
  square_hd: '1:1',
  square: '1:1',
  landscape: '16:9',
  portrait: '9:16',
};

/** Ratio for a size preset. fal writes "portrait_4_3", Krea/Ideogram "portrait_3_4": both are 3:4. */
function presetAspect(v: string): string | undefined {
  const m = /^(portrait|landscape)_(\d+)_(\d+)$/.exec(v);
  if (!m) return ASPECT_ALIASES[v];
  const [short, long] = [Number(m[2]), Number(m[3])].sort((a, b) => a - b);
  return m[1] === 'portrait' ? `${short}:${long}` : `${long}:${short}`;
}

/** Numeric w/h ratio for an aspect-ish value ("16:9", "landscape_4_3", "1280x720"), or null. */
export function ratioOf(value: string | number | undefined): number | null {
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  const src = presetAspect(v) ?? v;
  const m = /^(\d+(?:\.\d+)?)\s*[:x*]\s*(\d+(?:\.\d+)?)$/.exec(src);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? w / h : null;
}

export function aspectLabel(value: string | number | undefined): string {
  if (value == null) return '';
  const v = String(value);
  const alias = presetAspect(v.toLowerCase());
  if (alias) return v.toLowerCase().includes('hd') ? `${alias} HD` : alias;
  if (v === 'auto') return 'Auto';
  return v.replace('*', '×').replace(/(\d)x(\d)/, '$1×$2');
}

/** Options that mean "let the model decide" (P Image: match_input_image; Seedance: adaptive). */
export function isAutoOption(o: string | number): boolean {
  return /^(auto|match_input_image|adaptive)$/.test(String(o));
}

/** Pixel area of a "1024x768" / "1024*768" option, else null. */
function pixelArea(o: string | number | undefined): number | null {
  const m = /^(\d+)\s*[x*]\s*(\d+)$/.exec(String(o ?? '').trim());
  return m ? Number(m[1]) * Number(m[2]) : null;
}

/**
 * Pick the option whose ratio is closest to `target` (a ratio string or number). Among sizes of the same
 * ratio (1024x1024, 2048x2048) the one closest in area to `like` wins, so the scale is kept.
 */
export function nearestAspect(options: Array<string | number>, target: string | number | undefined, like?: string | number): string | undefined {
  if (!options.length) return undefined;
  const tr = typeof target === 'number' ? target : ratioOf(target);
  if (target != null && options.some((o) => String(o) === String(target))) return String(target);
  if (tr == null) return undefined;
  const scored = options.flatMap((o) => {
    const r = ratioOf(o);
    return r == null ? [] : [{ o: String(o), d: Math.abs(Math.log(r / tr)) }];
  });
  if (!scored.length) return undefined;
  const bestD = Math.min(...scored.map((x) => x.d));
  const near = scored.filter((x) => x.d <= bestD + 0.02);
  const area = pixelArea(like);
  if (area == null || near.length === 1) return near[0].o;
  return near.reduce((a, b) => (Math.abs((pixelArea(b.o) ?? 0) - area) < Math.abs((pixelArea(a.o) ?? 0) - area) ? b : a)).o;
}

/** Output pixel dimensions for an aspect ratio at a long-edge size. */
export function dimsFor(ratio: number, longEdge: number): { width: number; height: number } {
  if (ratio >= 1) return { width: longEdge, height: Math.round(longEdge / ratio) };
  return { width: Math.round(longEdge * ratio), height: longEdge };
}

export function numericValue(v: AdvancedValue | undefined): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Rough long-edge pixels for a resolution token, used for megapixel estimates. */
export function longEdgeFor(resolution: string | undefined): number {
  if (!resolution) return 1024;
  const r = resolution.toLowerCase();
  const size = /(\d+)\s*[x*]\s*(\d+)/.exec(r);
  if (size) return Math.max(Number(size[1]), Number(size[2]));
  if (r === '512') return 512;
  if (r.endsWith('k')) return Math.round(parseFloat(r) * 1024) || 1024;
  if (r.endsWith('p')) {
    const p = parseInt(r, 10);
    return Math.round((p * 16) / 9);
  }
  return 1024;
}

// ---------------------------------------------------------------------------
// JSON-schema (OpenAPI) → ParamDef + InputSlots

export interface JsonProp {
  type?: string | string[];
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  description?: string;
  title?: string;
  items?: JsonProp & { $ref?: string };
  anyOf?: JsonProp[];
  allOf?: JsonProp[];
  $ref?: string;
  maxItems?: number;
  minItems?: number;
  maxLength?: number;
  properties?: Record<string, JsonProp>;
  /** Atlas marks options it does not accept yet. */
  disabled?: boolean;
}

function flattenProp(p: JsonProp, resolve: (ref: string) => JsonProp | undefined): JsonProp {
  let out: JsonProp = { ...p };
  if (p.$ref) out = { ...(resolve(p.$ref) ?? {}), ...p, $ref: undefined };
  const alts = out.anyOf ?? out.allOf;
  if (alts?.length) {
    const concrete = alts.map((a) => (a.$ref ? resolve(a.$ref) ?? a : a)).filter((a) => a.type !== 'null');
    const withEnum = concrete.find((a) => a.enum?.length);
    const first = withEnum ?? concrete[0];
    if (first) out = { ...first, ...out, anyOf: undefined, allOf: undefined, type: first.type, enum: first.enum ?? out.enum };
  }
  return out;
}

function primaryType(p: JsonProp): string | undefined {
  if (Array.isArray(p.type)) return p.type.find((t) => t !== 'null');
  return p.type;
}

const SIZE_RATIOS: Array<[number, number]> = [[1, 1], [4, 3], [3, 4], [16, 9], [9, 16], [3, 2], [2, 3], [21, 9]];

/**
 * A free "width*height" text field (Atlas Qwen Image, Z-Image) becomes a list of sizes at the model's default
 * scale, or its largest one. Without a default the model may pick the size itself: "auto" (not sent) is offered.
 */
function sizeOptions(p: JsonProp): { options: string[]; default?: string; omit?: string } | null {
  const text = `${typeof p.default === 'string' ? p.default : ''} ${p.description ?? ''}`;
  const sizes = [...text.matchAll(/(\d{3,4})\s*([x*])\s*(\d{3,4})/g)];
  if (!sizes.length) return null;
  const sep = sizes[0][2];
  const def = typeof p.default === 'string' && /^\d+\s*[x*]\s*\d+$/.test(p.default) ? p.default : undefined;
  const edges = sizes.map((m) => Math.max(Number(m[1]), Number(m[3])));
  const long = def ? Math.max(...def.split(/[x*]/).map(Number)) : Math.min(p.maximum ?? Math.max(...edges), Math.max(...edges));
  const min = p.minimum ?? 256;
  const edge = (v: number) => Math.max(min, Math.round(v / 16) * 16);
  const options = SIZE_RATIOS.map(([w, h]) => (w >= h ? `${long}${sep}${edge((long * h) / w)}` : `${edge((long * w) / h)}${sep}${long}`));
  if (def && !options.includes(def)) options.unshift(def);
  return def ? { options, default: def } : { options: ['auto', ...options], default: 'auto', omit: 'auto' };
}

/** An array of `{ url, type: 'image' | 'video' | … }` items (Atlas `refers`). */
function isMixedRefList(p: JsonProp, resolve: (ref: string) => JsonProp | undefined): boolean {
  if (primaryType(p) !== 'array' || !p.items) return false;
  const item = flattenProp(p.items, resolve);
  const type = item.properties?.type;
  return Boolean(item.properties?.url && type?.enum?.includes('image'));
}

export function schemaFromJson(opts: {
  ref: string;
  kind: MediaKind;
  properties: Record<string, JsonProp>;
  required: string[];
  resolve: (ref: string) => JsonProp | undefined;
  imageFormat: ImageInputFormat;
  source: ModelSchema['source'];
}): ModelSchema {
  const { properties, required, kind, resolve, imageFormat } = opts;
  const slots: InputSlots = {};
  const params: ParamDef[] = [];
  const keys = Object.keys(properties);
  const lower = new Map(keys.map((k) => [normKey(k), k]));

  for (const pk of PROMPT_KEYS) {
    const k = lower.get(pk);
    if (k) {
      slots.prompt = k;
      slots.promptRequired = required.includes(k);
      break;
    }
  }

  const used = new Set<string>();
  if (slots.prompt) used.add(slots.prompt);

  if (kind === 'video') {
    const video = VIDEO_KEYS.map((k) => lower.get(k)).find(Boolean);
    if (video) {
      slots.video = { key: video, format: imageFormat };
      used.add(video);
    }
    const last = LAST_FRAME_KEYS.map((k) => lower.get(k)).find(Boolean);
    if (last) {
      slots.lastFrame = { key: last, format: imageFormat };
      used.add(last);
    }
    const first = FIRST_FRAME_KEYS.map((k) => lower.get(k)).find((k) => k && !used.has(k));
    if (first) {
      slots.firstFrame = { key: first, format: imageFormat };
      used.add(first);
    }
    const refs = MULTI_IMAGE_KEYS.map((k) => lower.get(k)).find((k) => k && !used.has(k));
    if (refs) {
      const p = flattenProp(properties[refs], resolve);
      slots.images = { key: refs, max: p.maxItems ?? 4, min: required.includes(refs) ? Math.max(1, p.minItems ?? 1) : 0, multiple: true, format: imageFormat };
      used.add(refs);
    }
    const refVideos = REF_VIDEO_KEYS.map((k) => lower.get(k)).find((k) => k && !used.has(k));
    if (refVideos) {
      const p = flattenProp(properties[refVideos], resolve);
      slots.refVideos = { key: refVideos, max: p.maxItems ?? 3, min: required.includes(refVideos) ? Math.max(1, p.minItems ?? 1) : 0, format: imageFormat };
      used.add(refVideos);
    }
    const mixed = keys.find((k) => !used.has(k) && isMixedRefList(flattenProp(properties[k], resolve), resolve));
    if (mixed) {
      const p = flattenProp(properties[mixed], resolve);
      slots.mixedRefs = { key: mixed, max: p.maxItems ?? 9, min: required.includes(mixed) ? Math.max(1, p.minItems ?? 1) : 0 };
      used.add(mixed);
    }
  } else {
    const multiKeys = MULTI_IMAGE_KEYS.map((k) => lower.get(k)).filter((k): k is string => Boolean(k));
    let multi: string | undefined = multiKeys.find((k) => required.includes(k)) ?? multiKeys[0];
    const required1 = SINGLE_IMAGE_KEYS.map((k) => lower.get(k)).find((k) => k && required.includes(k));
    // Ideogram remix/reframe: the source goes to a required image_url; image_urls are optional style refs.
    if (multi && required1 && !required.includes(multi)) multi = undefined;
    if (multi) {
      const p = flattenProp(properties[multi], resolve);
      slots.images = {
        key: multi,
        max: p.maxItems ?? 10,
        min: required.includes(multi) ? Math.max(1, p.minItems ?? 1) : 0,
        multiple: true,
        format: imageFormat,
      };
      used.add(multi);
    } else {
      const single = required1 ?? SINGLE_IMAGE_KEYS.map((k) => lower.get(k)).find(Boolean);
      if (single) {
        slots.images = { key: single, max: 1, min: required.includes(single) ? 1 : 0, multiple: false, format: imageFormat };
        used.add(single);
      }
    }
  }
  // Mask inputs and other media we do not drive from the UI.
  for (const k of keys) {
    const nk = normKey(k);
    if (/mask|video_url|videourl|audio_url|audiourl|lora|loras|embedding|control/.test(nk)) used.add(k);
  }

  const fixed: Record<string, unknown> = {};
  for (const key of keys) {
    if (used.has(key) || isHiddenKey(key)) continue;
    const p = flattenProp(properties[key], resolve);
    if (p.disabled) continue;
    const before = params.length;
    const t = primaryType(p);
    const options = (p.enum ?? []).filter((v): v is string | number => typeof v === 'string' || typeof v === 'number');
    const role = roleForKey(key, options);
    const base = { key, label: humanizeKey(p.title && p.title.length < 40 ? p.title : key), role, description: p.description?.slice(0, 200) };
    if (p.enum?.length) {
      if (!options.length) continue;
      const def = typeof p.default === 'string' || typeof p.default === 'number' ? p.default : undefined;
      params.push({ ...base, type: 'enum', options, default: def });
    } else if (t === 'boolean') {
      params.push({ ...base, type: 'boolean', default: typeof p.default === 'boolean' ? p.default : undefined });
    } else if (t === 'integer' || t === 'number') {
      const def = typeof p.default === 'number' ? p.default : undefined;
      params.push({ ...base, type: t, min: p.minimum, max: p.maximum, default: def, step: t === 'integer' ? 1 : undefined });
    } else if (t === 'string' && role === 'resolution' && sizeOptions(p)) {
      const sized = sizeOptions(p)!;
      params.push({ ...base, label: 'Size', role: 'aspect', type: 'enum', options: sized.options, default: sized.default, omit: sized.omit });
    } else if (t === 'string' && role === 'negative') {
      // Of the free-text params only the negative prompt is surfaced.
      params.push({ ...base, type: 'string', default: typeof p.default === 'string' ? p.default : undefined });
    }
    // A required field we do not surface (e.g. fal's prompt_expansion_mode) still has to be sent.
    if (params.length === before && required.includes(key) && p.default !== undefined) fixed[key] = p.default;
  }
  // A list of pixel sizes ("1024x768", "2048*2048") sets the framing: treat it as the aspect control.
  if (!params.some((p) => p.role === 'aspect')) {
    const sizes = params.find((p) => p.role === 'resolution' && p.options?.some((o) => pixelArea(o) != null) && p.options.every((o) => pixelArea(o) != null || isAutoOption(o)));
    if (sizes) Object.assign(sizes, { role: 'aspect', label: 'Size' });
  }
  const slotKeys = new Set(Object.values(slots).flatMap((v) => (v && typeof v === 'object' ? [v.key] : typeof v === 'string' ? [v] : [])));
  const missing = required.filter((k) => !slotKeys.has(k) && !isHiddenKey(k) && !params.some((p) => p.key === k) && !(k in fixed));
  return { ref: opts.ref, params, slots, fixed: Object.keys(fixed).length ? fixed : undefined, missing: missing.length ? missing : undefined, source: opts.source };
}

// ---------------------------------------------------------------------------
// Settings ↔ params

export function paramByRole(schema: ModelSchema | undefined, role: ParamRole): ParamDef | undefined {
  return schema?.params.find((p) => p.role === role);
}

export function maxCountPerRequest(schema: ModelSchema | undefined): number {
  const p = paramByRole(schema, 'count');
  if (!p) return 1;
  if (p.type === 'enum' && p.options?.length) return Math.max(...p.options.map((o) => Number(o) || 1));
  return p.max ?? 4;
}

function durationOptions(p: ParamDef): number[] {
  if (p.options?.length) return p.options.map((o) => numericValue(o)).filter((n): n is number => n != null);
  if (p.min != null && p.max != null) {
    const out: number[] = [];
    for (let s = Math.ceil(p.min); s <= p.max && out.length < 60; s++) out.push(s);
    return out;
  }
  return [];
}

export function durationChoices(schema: ModelSchema | undefined): number[] {
  const p = paramByRole(schema, 'duration');
  return p ? durationOptions(p) : [];
}

/** Some models take -1 (or 0) for "let the model choose the length". */
export function durationLabel(seconds: number): string {
  return seconds > 0 ? `${seconds}s` : 'Auto';
}

export function defaultSettings(schema: ModelSchema | undefined, kind: MediaKind): GenSettings {
  const s: GenSettings = { count: 1, advanced: {} };
  if (!schema) return s;
  const aspect = paramByRole(schema, 'aspect');
  if (aspect?.options?.length) {
    const preferred = kind === 'video' ? '16:9' : '1:1';
    const def = typeof aspect.default !== 'boolean' && aspect.default !== aspect.omit ? aspect.default : undefined;
    s.aspect = nearestAspect(aspect.options.filter((o) => !isAutoOption(o)), preferred, def) ?? String(aspect.default ?? aspect.options[0]);
  }
  const res = paramByRole(schema, 'resolution');
  if (res?.options?.length) s.resolution = String(res.default ?? res.options[0]);
  const dur = paramByRole(schema, 'duration');
  if (dur) {
    const choices = durationOptions(dur);
    const def = numericValue(dur.default as AdvancedValue);
    s.duration = def ?? (choices.includes(5) ? 5 : choices[0]);
  }
  const audio = paramByRole(schema, 'audio');
  if (audio) s.audio = typeof audio.default === 'boolean' ? audio.default : false;
  return s;
}

/** Make settings valid for a model, keeping the intent (nearest aspect, nearest duration...). */
export function coerceSettings(schema: ModelSchema | undefined, kind: MediaKind, input: Partial<GenSettings>): { settings: GenSettings; changes: string[] } {
  const base = defaultSettings(schema, kind);
  const changes: string[] = [];
  const out: GenSettings = { ...base, count: Math.max(1, Math.min(8, Math.round(input.count ?? 1))), advanced: {} };
  if (!schema) return { settings: { ...out, seed: input.seed }, changes };

  const aspect = paramByRole(schema, 'aspect');
  if (aspect?.options?.length && input.aspect != null) {
    const exact = aspect.options.find((o) => String(o) === String(input.aspect));
    const near = exact != null ? String(exact) : nearestAspect(aspect.options, input.aspect, base.aspect);
    if (near) {
      out.aspect = near;
      if (near !== String(input.aspect)) changes.push(`aspect ${input.aspect} → ${aspectLabel(near)}`);
    }
  }
  const res = paramByRole(schema, 'resolution');
  if (res?.options?.length && input.resolution != null) {
    const match = res.options.find((o) => String(o).toLowerCase() === String(input.resolution).toLowerCase());
    if (match != null) out.resolution = String(match);
    else changes.push(`resolution ${input.resolution} → ${out.resolution}`);
  }
  const dur = paramByRole(schema, 'duration');
  if (dur && input.duration != null) {
    const choices = durationOptions(dur);
    if (choices.length) {
      const nearest = choices.reduce((a, b) => (Math.abs(b - input.duration!) < Math.abs(a - input.duration!) ? b : a), choices[0]);
      out.duration = nearest;
      if (nearest !== input.duration) changes.push(`duration ${input.duration}s → ${nearest}s`);
    }
  }
  const audio = paramByRole(schema, 'audio');
  if (audio && input.audio != null) out.audio = input.audio;
  if (!audio && input.audio) changes.push('audio not supported by this model');
  if (paramByRole(schema, 'seed') && input.seed != null) out.seed = input.seed;
  if (paramByRole(schema, 'negative') && input.negative) out.negative = input.negative;

  for (const [k, v] of Object.entries(input.advanced ?? {})) {
    const def = schema.params.find((p) => p.key === k && p.role === 'other');
    if (!def) continue;
    if (def.type === 'enum' && !def.options?.some((o) => String(o) === String(v))) continue;
    if (def.type === 'boolean' && typeof v !== 'boolean') continue;
    if ((def.type === 'number' || def.type === 'integer') && typeof v !== 'number') continue;
    out.advanced[k] = v;
  }
  return { settings: out, changes };
}

/** Wire parameters for one request (count is applied separately by the job runner). */
export function wireParams(schema: ModelSchema, settings: GenSettings, countForRequest: number): Record<string, unknown> {
  const out: Record<string, unknown> = { ...schema.fixed };
  for (const p of schema.params) {
    switch (p.role) {
      case 'aspect':
        if (settings.aspect != null && settings.aspect !== p.omit) out[p.key] = castOption(p, settings.aspect);
        break;
      case 'resolution':
        if (settings.resolution != null) out[p.key] = castOption(p, settings.resolution);
        break;
      case 'duration':
        if (settings.duration != null) {
          if (p.options?.length) {
            const opt = p.options.find((o) => numericValue(o) === settings.duration);
            if (opt != null) out[p.key] = opt;
          } else {
            out[p.key] = p.type === 'string' ? String(settings.duration) : settings.duration;
          }
        }
        break;
      case 'count':
        if (countForRequest > 1 || p.default == null) {
          out[p.key] = p.type === 'enum' ? castOption(p, String(countForRequest)) : countForRequest;
        }
        break;
      case 'audio':
        if (settings.audio != null) out[p.key] = settings.audio;
        break;
      case 'seed':
        if (settings.seed != null) out[p.key] = settings.seed;
        break;
      case 'negative':
        if (settings.negative) out[p.key] = settings.negative;
        break;
      case 'other':
        if (settings.advanced[p.key] !== undefined) out[p.key] = settings.advanced[p.key];
        break;
    }
  }
  return out;
}

function castOption(p: ParamDef, value: string): string | number {
  const match = p.options?.find((o) => String(o) === String(value));
  if (match != null) return match;
  if (p.type === 'integer' || p.type === 'number') return Number(value);
  return value;
}

// ---------------------------------------------------------------------------
// Video inputs

/**
 * Where a video model's inputs go. The first image is the start frame when the model has one; the other
 * images are references (all of them when there is no start frame). Videos are always references.
 */
export function routeVideoInputs<T>(slots: InputSlots, images: T[], videos: T[], firstFrame?: T): { firstFrame?: T; images: T[]; videos: T[] } {
  const rest = [...images];
  let first = firstFrame;
  if (!first && slots.firstFrame && rest.length) first = rest.shift();
  if (first && !slots.firstFrame && (slots.images || slots.mixedRefs)) {
    rest.unshift(first);
    first = undefined;
  }
  return { firstFrame: first, images: rest, videos };
}

/** Why a video model cannot take these routed inputs, or null. Sentence without subject ("needs …"). */
export function videoInputProblem(slots: InputSlots, n: { firstFrame: boolean; images: number; videos: number }): string | null {
  if (n.firstFrame && !slots.firstFrame) return 'cannot start from an image.';
  const mixed = slots.mixedRefs;
  if (mixed) {
    const total = n.images + n.videos;
    if (total > mixed.max) return `accepts up to ${mixed.max} references.`;
    if (total < mixed.min) return 'needs at least one reference image or video.';
    return null;
  }
  const imageMax = slots.images?.max ?? 0;
  if (n.images > imageMax) return imageMax ? `accepts up to ${imageMax} reference images.` : slots.firstFrame ? 'takes one start image.' : 'does not accept reference images.';
  if (slots.images && n.images < slots.images.min) return 'needs a reference image.';
  const videoMax = slots.refVideos?.max ?? 0;
  if (n.videos > videoMax) return videoMax ? `accepts up to ${videoMax} reference videos.` : 'does not accept reference videos (use Extract frame to start from a still).';
  if (slots.refVideos && n.videos < slots.refVideos.min) return 'needs a reference video.';
  return null;
}
