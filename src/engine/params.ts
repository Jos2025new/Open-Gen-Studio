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
// Audio inputs: reference lists, and single tracks (lip-sync speech, soundtrack). `audio` alone is usually the
// "generate audio" switch, so a single-track key only counts when its value is a string.
const REF_AUDIO_KEYS = ['reference_audios', 'reference_audio_urls', 'audio_urls'];
const AUDIO_KEYS = ['audio_url', 'target_audio_url', 'driving_audio_url', 'input_audio', 'audio_file'];
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

/** Kling elements: `{ element_name, frontal_image, refer_images… }` (Atlas) or `{ frontal_image_url, reference_image_urls… }` (fal). */
function elementList(p: JsonProp, resolve: (ref: string) => JsonProp | undefined): Omit<NonNullable<InputSlots['elements']>, 'key'> | null {
  if (primaryType(p) !== 'array' || !p.items) return null;
  const props = flattenProp(p.items, resolve).properties ?? {};
  const frontal = props.frontal_image ?? props.frontal_image_url;
  if (!frontal) return null;
  const refs = flattenProp(props.refer_images ?? props.reference_image_urls ?? {}, resolve);
  return {
    max: p.maxItems ?? 6,
    style: props.element_name ? 'atlas' : 'fal',
    // Atlas's wrapper names elements <<<element_N>>>; fal's schemas say @Element1.
    mention: props.element_name || /<<<element_N>>>/.test(p.description ?? '') ? '<<<element_{n}>>>' : '@Element{n}',
    refMax: refs.maxItems ?? 3,
    video: Boolean(props.refer_videos ?? props.video_url),
    voice: Boolean(props.voice_id),
  };
}

/** Kling multi-shot: `[{ prompt, duration }]`, sometimes with a 1-based `index`. */
function shotList(p: JsonProp, resolve: (ref: string) => JsonProp | undefined): { indexed: boolean; durationAsString: boolean; max: number } | null {
  if (primaryType(p) !== 'array' || !p.items) return null;
  const props = flattenProp(p.items, resolve).properties ?? {};
  if (!props.prompt || !props.duration) return null;
  return { indexed: Boolean(props.index), durationAsString: primaryType(flattenProp(props.duration, resolve)) === 'string', max: p.maxItems ?? 6 };
}

/** An array of `{ image_url, frame_index }` items (FLUX 3 keyframes). */
function keyframeList(p: JsonProp, resolve: (ref: string) => JsonProp | undefined): { imageKey: string; indexKey: string } | null {
  if (primaryType(p) !== 'array' || !p.items) return null;
  const props = flattenProp(p.items, resolve).properties ?? {};
  const indexKey = Object.keys(props).find((k) => /^frame_?index$/i.test(k));
  const imageKey = Object.keys(props).find((k) => /^image(_url)?$/i.test(k));
  return indexKey && imageKey ? { imageKey, indexKey } : null;
}

/** An array of `{ url, start, ends }` trimmed clips (Gemini / Nano Banana `video_clips`). */
function clipList(p: JsonProp, resolve: (ref: string) => JsonProp | undefined): NonNullable<InputSlots['clips']> | null {
  if (primaryType(p) !== 'array' || !p.items) return null;
  const props = flattenProp(p.items, resolve).properties ?? {};
  if (!props.url || !props.start || !props.ends) return null;
  const text = `${p.description ?? ''} ${props.ends.description ?? ''}`;
  const span = /(?:must not exceed|at most|up to)\s*(\d+)\s*seconds/i.exec(text);
  const fps = props.fps;
  return {
    key: '',
    max: p.maxItems ?? 1,
    min: 0,
    maxSpan: span ? Number(span[1]) : undefined,
    integer: primaryType(props.start) === 'integer',
    wholeEnd: props.ends.default === 0 && /whole/i.test(props.ends.description ?? '') ? 0 : undefined,
    fps: fps ? { key: 'fps', value: typeof fps.default === 'number' ? fps.default : 1 } : undefined,
  };
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
    // Ideogram Character remix/edit: a required source image and a required reference list.
    if (multi && required1 && required.includes(multi)) {
      slots.source = { key: required1, format: imageFormat };
      used.add(required1);
    }
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
  // Structured inputs, for either kind: keyframe lists (FLUX 3) and trimmed clips (video_clips).
  for (const k of keys) {
    if (used.has(k)) continue;
    const p = flattenProp(properties[k], resolve);
    const min = required.includes(k) ? Math.max(1, p.minItems ?? 1) : 0;
    if (REF_AUDIO_KEYS.includes(normKey(k)) && primaryType(p) === 'array') {
      slots.refAudios = { key: k, max: p.maxItems ?? 3, min, format: imageFormat };
      used.add(k);
      continue;
    }
    if (AUDIO_KEYS.includes(normKey(k)) && primaryType(p) === 'string' && !slots.audio) {
      slots.audio = { key: k, required: required.includes(k), format: imageFormat };
      used.add(k);
      continue;
    }
    const el = elementList(p, resolve);
    if (el) {
      slots.elements = { key: k, ...el };
      used.add(k);
      continue;
    }
    const shots = normKey(k) === 'multi_prompt' ? shotList(p, resolve) : null;
    if (shots) {
      const flagKey = lower.get('multi_shot');
      const modeKey = lower.get('shot_type');
      const exclusive = /not both/i.test(`${p.description ?? ''} ${properties[slots.prompt ?? '']?.description ?? ''}`);
      slots.shots = { key: k, ...shots, flagKey, modeKey, exclusivePrompt: exclusive };
      used.add(k);
      if (flagKey) used.add(flagKey);
      if (modeKey) used.add(modeKey);
      continue;
    }
    const kf = keyframeList(p, resolve);
    if (kf) {
      const fps = /(\d+)\s*fps/i.exec(`${p.description ?? ''} ${JSON.stringify(p.items ?? {})}`);
      slots.keyframes = { key: k, max: p.maxItems ?? 10, min, ...kf, fps: fps ? Number(fps[1]) : 24 };
      used.add(k);
      continue;
    }
    const clips = clipList(p, resolve);
    if (clips) {
      slots.clips = { ...clips, key: k, min };
      used.add(k);
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
    } else if (t === 'array' && p.items && flattenProp(p.items, resolve).enum?.length) {
      // A list of fixed choices (Grok voice_ids): several can be picked.
      const choices = (flattenProp(p.items, resolve).enum ?? []).filter((v): v is string | number => typeof v === 'string' || typeof v === 'number');
      params.push({ ...base, type: 'multi', options: choices, max: p.maxItems, min: p.minItems });
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
  // Seedream sequential: max_images is the series length when the model has no other count field.
  if (!params.some((p) => p.role === 'count')) {
    const series = params.find((p) => normKey(p.key) === 'max_images' && (p.type === 'integer' || p.type === 'number'));
    if (series) Object.assign(series, { role: 'count', label: 'Images' });
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

  // Structured values survive a model change only where the new model takes them.
  if (schema.slots.shots && input.shots?.length) {
    const shots = input.shots.filter((sh) => sh.prompt.trim() && sh.duration >= 1).slice(0, schema.slots.shots.max);
    if (shots.length) out.shots = shots;
  } else if (input.shots?.length) changes.push('multi-shot not supported by this model');
  const extras: Record<string, unknown> = {};
  for (const p of schema.params.filter((x) => x.type === 'multi')) {
    const v = input.extras?.[p.key];
    if (!Array.isArray(v)) continue;
    const picked = v.filter((x) => p.options?.some((o) => String(o) === String(x))).slice(0, p.max ?? v.length);
    if (picked.length) extras[p.key] = picked;
  }
  if (Object.keys(extras).length) out.extras = extras;

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
        if (p.type === 'multi') {
          const picked = settings.extras?.[p.key];
          if (Array.isArray(picked) && picked.length) out[p.key] = picked;
        } else if (settings.advanced[p.key] !== undefined) out[p.key] = settings.advanced[p.key];
        break;
    }
  }
  // Multi-shot storyboard: the shots, plus the switches that turn it on.
  const shots = schema.slots.shots;
  if (shots && settings.shots?.length) {
    out[shots.key] = settings.shots.map((sh, i) => ({ ...(shots.indexed ? { index: i + 1 } : {}), prompt: sh.prompt, duration: shots.durationAsString ? String(sh.duration) : sh.duration }));
    if (shots.flagKey) out[shots.flagKey] = true;
    if (shots.modeKey) out[shots.modeKey] = 'customize';
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
  // Keyframe models pin every image, the start frame first.
  if (slots.keyframes) return { firstFrame: undefined, images: firstFrame ? [firstFrame, ...images] : [...images], videos };
  const rest = [...images];
  let first = firstFrame;
  if (!first && slots.firstFrame && rest.length) first = rest.shift();
  if (first && !slots.firstFrame && (slots.images || slots.mixedRefs)) {
    rest.unshift(first);
    first = undefined;
  }
  return { firstFrame: first, images: rest, videos };
}

/** Audio inputs: the first track goes to a single-track field (lip-sync, soundtrack) when there is one, the rest are references. */
export function routeAudio<T>(slots: InputSlots, audios: T[]): { audio?: T; refAudios: T[] } {
  if (slots.audio && !slots.mixedRefs && audios.length) return { audio: audios[0], refAudios: audios.slice(1) };
  return { refAudios: [...audios] };
}

/** Why a model cannot take this many audio inputs, or null. */
export function audioInputProblem(slots: InputSlots, audios: number): string | null {
  if (slots.mixedRefs) return null; // counted with the other references
  const max = (slots.audio ? 1 : 0) + (slots.refAudios?.max ?? 0);
  if (audios > max) return max ? `accepts up to ${max} audio track${max > 1 ? 's' : ''}.` : 'does not accept audio.';
  if (slots.audio?.required && audios < 1) return 'needs an audio track.';
  if (audios < (slots.refAudios?.min ?? 0) + (slots.audio?.required ? 1 : 0)) return 'needs reference audio.';
  return null;
}

/** Why a video model cannot take these routed inputs, or null. Sentence without subject ("needs …"). */
export function videoInputProblem(slots: InputSlots, n: { firstFrame: boolean; images: number; videos: number; audios?: number }): string | null {
  if (n.firstFrame && !slots.firstFrame) return 'cannot start from an image.';
  const audioProblem = audioInputProblem(slots, n.audios ?? 0);
  if (audioProblem) return audioProblem;
  const mixed = slots.mixedRefs;
  if (mixed) {
    const total = n.images + n.videos + (n.audios ?? 0);
    if (total > mixed.max) return `accepts up to ${mixed.max} references.`;
    // Audio alone is not a reference set (MiniMax H3): at least one image or video.
    if (n.images + n.videos < mixed.min) return 'needs at least one reference image or video.';
    return null;
  }
  const kf = slots.keyframes;
  const imageMax = kf?.max ?? slots.images?.max ?? 0;
  const what = kf ? 'keyframe images' : 'reference images';
  if (n.images > imageMax) return imageMax ? `accepts up to ${imageMax} ${what}.` : slots.firstFrame ? 'takes one start image.' : 'does not accept reference images.';
  if (n.images < (kf?.min ?? slots.images?.min ?? 0)) return kf ? 'needs at least one keyframe image.' : 'needs a reference image.';
  const videos = slots.clips ?? slots.refVideos;
  const videoMax = videos?.max ?? 0;
  if (n.videos > videoMax) return videoMax ? `accepts up to ${videoMax} reference ${slots.clips ? 'clip' : 'video'}${videoMax > 1 ? 's' : ''}.` : 'does not accept reference videos (use Extract frame to start from a still).';
  if (videos && n.videos < videos.min) return slots.clips ? 'needs a reference video clip.' : 'needs a reference video.';
  return null;
}

/**
 * Keyframe frame indices (BFL FLUX 3 guide): one image opens the clip, two pin start and end, three to ten are
 * spread evenly. Seconds set by the user win. Indices are unique and within 0..duration × fps.
 */
export function placeKeyframes(count: number, duration: number, fps: number, seconds: Array<number | null | undefined> = []): number[] {
  const last = Math.max(0, Math.round(duration * fps));
  const frames: number[] = [];
  for (let i = 0; i < count; i++) {
    const at = seconds[i];
    let f = at != null && Number.isFinite(at) ? Math.round(Math.min(Math.max(at, 0), duration) * fps) : count === 1 ? 0 : Math.round((i * last) / (count - 1));
    // Nudge collisions to the nearest free frame.
    for (let d = 1; frames.includes(f) && d <= last; d++) f = !frames.includes(f + d) && f + d <= last ? f + d : f - d >= 0 && !frames.includes(f - d) ? f - d : f;
    frames.push(f);
  }
  return frames;
}

/** Trim [start, end] for a reference clip: the user's, else the whole clip or the longest span the model takes. */
export function clipTrim(slot: NonNullable<InputSlots['clips']>, seconds: number | undefined, override?: [number, number]): [number, number] {
  let [start, end] = override ?? [0, slot.wholeEnd != null && !slot.maxSpan ? slot.wholeEnd : Math.min(seconds ?? slot.maxSpan ?? 10, slot.maxSpan ?? Infinity)];
  if (slot.maxSpan && end - start > slot.maxSpan) end = start + slot.maxSpan;
  if (slot.integer) {
    start = Math.floor(start);
    end = end === 0 ? 0 : Math.max(start + 1, Math.round(end));
  }
  return [start, end];
}

/** What a model takes as input, in the words the agent's plan uses (refs, first_frame, times…). */
export function capabilityHints(schema: ModelSchema | undefined, kind: MediaKind): string[] {
  if (!schema) return ['inputs unknown until the model loads'];
  const s = schema.slots;
  const out: string[] = [];
  if (kind === 'video') {
    if (s.firstFrame) out.push('first_frame');
    if (s.lastFrame) out.push('last_frame');
    if (s.keyframes) out.push(`keyframes: up to ${s.keyframes.max} image refs in order, optional times (seconds), ${s.keyframes.fps} fps`);
    if (s.images) out.push(`up to ${s.images.max} reference image refs${s.images.min ? ' (required)' : ''}`);
    if (s.refVideos) out.push(`up to ${s.refVideos.max} reference video refs`);
    if (s.mixedRefs) out.push(`up to ${s.mixedRefs.max} image/video refs${s.mixedRefs.min ? ' (at least one required)' : ''}`);
    if (s.clips) out.push(`${s.clips.max} reference video clip${s.clips.maxSpan ? ` (≤${s.clips.maxSpan} s used)` : ''}${s.clips.min ? ' (required)' : ''}`);
    if (!out.length) out.push('text-to-video only');
  } else {
    if (s.source) out.push('source image first in refs, then references');
    out.push(s.images ? `up to ${s.images.max + (s.source ? 1 : 0)} image refs${s.images.min ? ' (required)' : ''}` : 'no image input');
    if (s.clips) out.push(`${s.clips.max} video clip ref${s.clips.min ? ' (required)' : ''}`);
  }
  if (s.elements) out.push(`subjects: mention session subjects as @Name (up to ${s.elements.max}; each a frontal image + up to ${s.elements.refMax} views${s.elements.video ? ' or a video' : ''}${s.elements.voice ? ', optional voice' : ''})`);
  if (s.shots) out.push(`multi-shot: shots [{prompt, duration}] adding up to the duration (up to ${s.shots.max})`);
  if (s.audio) out.push(`an audio ref${s.audio.required ? ' (required: the speech or track to follow)' : ' (optional soundtrack)'}`);
  if (s.refAudios) out.push(`up to ${s.refAudios.max} reference audio refs`);
  if (s.mixedRefs) out.push('audio refs count among the references');
  if (schema.missing?.length) out.push(`cannot run from the app (needs ${schema.missing.join(', ')})`);
  return out;
}

/**
 * Subject mentions: "@Name" in the prompt, in order of first appearance. With a template ("@Element{n}",
 * "<<<element_{n}>>>") each mention becomes the provider's element reference; without one, the plain name.
 */
export function mentionSubjects(prompt: string, subjects: Array<{ id: string; name: string }>, template?: string): { prompt: string; ids: string[] } {
  const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Longest names claim their text first, so "@Ana Maria" is never also read as "@Ana".
  const hits: Array<{ start: number; end: number; id: string; name: string }> = [];
  for (const s of subjects.filter((x) => x.name.trim()).sort((a, b) => b.name.length - a.name.length)) {
    for (const m of prompt.matchAll(new RegExp(`@${esc(s.name)}(?![\\p{L}\\p{N}_-])`, 'giu'))) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (!hits.some((h) => start < h.end && end > h.start)) hits.push({ start, end, id: s.id, name: s.name });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const ids = [...new Set(hits.map((h) => h.id))];
  let out = '';
  let at = 0;
  for (const h of hits) {
    out += prompt.slice(at, h.start) + (template ? template.replace('{n}', String(ids.indexOf(h.id) + 1)) : h.name);
    at = h.end;
  }
  return { prompt: out + prompt.slice(at), ids };
}

/** Why a storyboard does not fit the clip, or null: shots must add up to the duration. */
export function shotsProblem(shots: Array<{ prompt: string; duration: number }> | undefined, duration: number | undefined): string | null {
  if (!shots?.length) return null;
  if (shots.some((s) => !s.prompt.trim())) return 'every shot needs a prompt.';
  const total = shots.reduce((t, s) => t + s.duration, 0);
  if (duration != null && duration > 0 && total !== duration) return `shots add up to ${total} s but the clip is ${duration} s.`;
  return null;
}
