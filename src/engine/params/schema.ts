import type { ImageInputFormat, InputSlots, MediaKind, ModelSchema, ParamDef } from '../types';
import { AUDIO_KEYS, FIRST_FRAME_KEYS, LAST_FRAME_KEYS, MASK_KEYS, MULTI_IMAGE_KEYS, PROMPT_KEYS, REF_AUDIO_KEYS, REF_VIDEO_KEYS, SINGLE_IMAGE_KEYS, VIDEO_KEYS, humanizeKey, isHiddenKey, normKey, roleForKey } from './keys';
import { isAutoOption, pixelArea } from './aspect';

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
  /** MiniMax lyrics: section tags ([Verse], [Chorus]…) the text may use. */
  'x-structure-tags'?: { section?: string[] };
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

/** Kling elements, Atlas or fal shape. */
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

/**
 * Style controls that are not simple values: RGB colors and lists (Recraft), Ideogram palettes, style codes,
 * custom style / model ids. Their values live in settings.extras (see structuredWire / normalizeStructured).
 */
function structuredParam(key: string, p: JsonProp, resolve: (ref: string) => JsonProp | undefined): Pick<ParamDef, 'type' | 'options' | 'max' | 'pattern'> | null {
  const isRgb = (x: JsonProp | undefined) => Boolean(x?.properties?.r && x.properties.g && x.properties.b);
  const item = p.items ? flattenProp(p.items, resolve) : undefined;
  const t = primaryType(p);
  const k = normKey(key);
  if (t === 'array' && isRgb(item)) return { type: 'colors', max: p.maxItems ?? 5 };
  if (isRgb(p)) return { type: 'color' };
  if (p.properties?.members && p.properties.name) {
    const presets = (flattenProp(p.properties.name, resolve).enum ?? []).filter((v): v is string => typeof v === 'string');
    return { type: 'palette', options: presets };
  }
  if (t === 'array' && item && primaryType(item) === 'string' && !item.enum && k === 'style_codes') return { type: 'textList', pattern: '^[0-9a-fA-F]{8}$', max: p.maxItems };
  if (t === 'string' && (k === 'style_id' || k === 'model_id')) return { type: 'text' };
  return null;
}

type Rgb = { r: number; g: number; b: number };

/** "#rrggbb" or {r,g,b} → {r,g,b}. */
export function toRgb(v: unknown): Rgb | null {
  if (typeof v === 'string') {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(v.trim());
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
  }
  if (v && typeof v === 'object' && ['r', 'g', 'b'].every((c) => Number.isFinite((v as Record<string, unknown>)[c]))) {
    const o = v as Rgb;
    return { r: Math.round(o.r), g: Math.round(o.g), b: Math.round(o.b) };
  }
  return null;
}

export function rgbHex(c: Rgb): string {
  return `#${[c.r, c.g, c.b].map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('')}`;
}

/** Ideogram palette as stored: a preset, or colors with weights. */
export type PaletteValue = { preset?: string; colors?: Array<{ hex: string; weight?: number }> };

/** A structured value from the UI or the agent (hex strings, comma lists…) in its stored form, or undefined. */
export function normalizeStructured(p: ParamDef, v: unknown): unknown {
  const list = (x: unknown) => (Array.isArray(x) ? x : typeof x === 'string' ? x.split(',') : []);
  switch (p.type) {
    case 'color': {
      const c = toRgb(v);
      return c ? rgbHex(c) : undefined;
    }
    case 'colors': {
      const cs = list(v).map(toRgb).filter((c): c is Rgb => Boolean(c)).slice(0, p.max ?? 5).map(rgbHex);
      return cs.length ? cs : undefined;
    }
    case 'palette': {
      const presetOf = (x: unknown) => (typeof x === 'string' && p.options?.some((o) => String(o) === x.trim().toUpperCase()) ? x.trim().toUpperCase() : undefined);
      if (presetOf(v)) return { preset: presetOf(v) };
      const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as { preset?: unknown; colors?: unknown }) : { colors: v };
      if (presetOf(o.preset)) return { preset: presetOf(o.preset) };
      const colors: Array<{ hex: string; weight?: number }> = [];
      for (const c of list(o.colors)) {
        const entry: { hex: unknown; weight?: unknown } = c && typeof c === 'object' && 'hex' in c ? (c as { hex: unknown; weight?: unknown }) : { hex: c };
        const rgb = toRgb(entry.hex);
        if (!rgb) continue;
        const w = Number(entry.weight);
        colors.push(Number.isFinite(w) && w > 0 ? { hex: rgbHex(rgb), weight: Math.max(0.05, Math.min(1, w)) } : { hex: rgbHex(rgb) });
      }
      return colors.length ? { colors } : undefined;
    }
    case 'text': {
      // Lyrics keep their line breaks while typed; ids are trimmed.
      const s = typeof v === 'string' ? (p.multiline ? v : v.trim()) : '';
      return s.trim() ? s : undefined;
    }
    case 'textList': {
      const re = p.pattern ? new RegExp(p.pattern) : null;
      const items = list(v).map((x) => String(x).trim()).filter((x) => x && (!re || re.test(x))).slice(0, p.max ?? 20);
      return items.length ? items : undefined;
    }
    case 'multi': {
      const picked = list(v).map(String).filter((x) => p.options?.some((o) => String(o) === x)).slice(0, p.max ?? 99);
      return picked.length ? picked : undefined;
    }
    default:
      return undefined;
  }
}

/** The request value for a stored structured value. */
export function structuredWire(p: ParamDef, v: unknown): unknown {
  const stored = normalizeStructured(p, v);
  if (stored === undefined) return undefined;
  switch (p.type) {
    case 'color':
      return toRgb(stored);
    case 'colors':
      return (stored as string[]).map(toRgb);
    case 'palette': {
      const pal = stored as PaletteValue;
      return pal.preset ? { name: pal.preset } : { members: (pal.colors ?? []).map((c) => ({ rgb: toRgb(c.hex), ...(c.weight ? { color_weight: c.weight } : {}) })) };
    }
    case 'text':
      return (stored as string).trim();
    default:
      return stored;
  }
}

export const STRUCTURED_TYPES = new Set<ParamDef['type']>(['multi', 'color', 'colors', 'palette', 'text', 'textList']);

/** An array of `{ url, type: 'image' | 'video' | … }` items (Atlas `refers`). */
function isMixedRefList(p: JsonProp, resolve: (ref: string) => JsonProp | undefined): boolean {
  if (primaryType(p) !== 'array' || !p.items) return false;
  const item = flattenProp(p.items, resolve);
  const type = item.properties?.type;
  return Boolean(item.properties?.url && type?.enum?.includes('image'));
}

/** Longest prompt: maxLength, or "up to / max N characters" in the description (not recommendations). */
export function promptLimit(p: JsonProp | undefined): number | undefined {
  const fromText = /(?:up to|max(?:imum)?(?: length)?(?: is| of)?)\s*([\d,]+)\s*characters/i.exec(p?.description ?? '');
  const limits = [p?.maxLength, fromText ? Number(fromText[1].replace(/,/g, '')) : undefined].filter((n): n is number => Number.isFinite(n) && n! > 0);
  return limits.length ? Math.min(...limits) : undefined;
}

/** The sentence of a prompt description that says how to cite the inputs (the provider's own syntax), if any. */
export function promptCitation(description: string | undefined): string | undefined {
  if (!description) return undefined;
  const sentences = description.split(/(?<=[.!?])\s+/);
  const hit = sentences.find((t) => /@(image|video|audio)\s?\d|<\s*image_?\d|<\s*picture|\bimage\s?\d\b|\bvideo\s?\d\b|character\s?\d|<<<element/i.test(t));
  return hit ? truncateText(hit.trim(), 220) : undefined;
}

function truncateText(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** A list's declared max, else `d` marked assumed (officialLimits.ts). */
const cap = (p: JsonProp, d: number) => (p.maxItems == null ? { max: d, from: 'assumed' as const } : { max: p.maxItems });

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
      const limit = promptLimit(properties[k]);
      if (limit) slots.promptMax = limit;
      const cites = promptCitation(properties[k]?.description);
      if (cites) slots.promptRefs = cites;
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
      slots.firstFrame = { key: first, format: imageFormat, ...(required.includes(first) ? { required: true } : {}) };
      used.add(first);
    }
    const refs = MULTI_IMAGE_KEYS.map((k) => lower.get(k)).find((k) => k && !used.has(k));
    if (refs) {
      const p = flattenProp(properties[refs], resolve);
      slots.images = { key: refs, ...cap(p, 4), min: required.includes(refs) ? Math.max(1, p.minItems ?? 1) : 0, multiple: true, format: imageFormat };
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
  } else if (kind === 'image' || kind === 'model3d') {
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
        ...cap(p, 10),
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
    if (MASK_KEYS.includes(normKey(k)) && primaryType(p) === 'string' && !slots.mask) {
      // OpenAI masks mark the area with transparency; the others with white.
      const alpha = /transparen/i.test(p.description ?? '') || /gpt-image/i.test(opts.ref);
      slots.mask = { key: k, required: required.includes(k), convention: alpha ? 'alpha' : 'white', format: imageFormat };
      used.add(k);
      continue;
    }
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
    const structured = structuredParam(key, p, resolve);
    const nk = normKey(key);
    if (kind === 'audio' && t === 'string' && !p.enum && (nk === 'lyrics' || nk === 'title')) {
      // Song text (MiniMax Music / Lyrics): lyrics in a text area with its section tags, the title as a line.
      const tags = p['x-structure-tags']?.section ?? [];
      params.push({ ...base, role: 'other', type: 'text', max: p.maxLength, ...(nk === 'lyrics' ? { multiline: true, tags } : {}) });
    } else if (kind === 'audio' && nk === 'format' && options.includes('pcm')) {
      // Raw PCM has no container: the browser can neither play nor measure it.
      const playable = options.filter((o) => o !== 'pcm');
      params.push({ ...base, type: 'enum', options: playable, default: playable.includes(p.default as string) ? (p.default as string) : playable[0] });
    } else if (structured) {
      params.push({ ...base, role: 'other', ...structured });
    } else if (p.enum?.length) {
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
