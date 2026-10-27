import type { AdvancedValue, GenSettings, MediaKind, ModelSchema, ParamDef, ParamRole } from '../types';
import { aspectLabel, isAutoOption, nearestAspect, numericValue } from './aspect';
import { STRUCTURED_TYPES, normalizeStructured, structuredWire } from './schema';
import { durationOptions } from './duration';
import { castOption } from './inputs';

export function paramByRole(schema: ModelSchema | undefined, role: ParamRole): ParamDef | undefined {
  return schema?.params.find((p) => p.role === role);
}

export function maxCountPerRequest(schema: ModelSchema | undefined): number {
  const p = paramByRole(schema, 'count');
  if (!p) return 1;
  if (p.type === 'enum' && p.options?.length) return Math.max(...p.options.map((o) => Number(o) || 1));
  return p.max ?? 4;
}

function resolutionRank(o: unknown): number {
  const m = /^(\d+(?:\.\d+)?)\s*(p|k)?$/i.exec(String(o).trim());
  if (!m) return NaN;
  return m[2]?.toLowerCase() === 'k' ? parseFloat(m[1]) * 1000 : parseFloat(m[1]);
}

/**
 * Medium quality (PLAN_AGENT_ROUTE.md R1): the middle size the model offers (720p among 480p/720p/1080p), or the
 * model's own default when that is smaller. Never the highest by default: resolution can multiply the price.
 */
export function mediumResolution(options: Array<string | number>, def?: unknown): string {
  const sized = options.filter((o) => Number.isFinite(resolutionRank(o))).sort((a, b) => resolutionRank(a) - resolutionRank(b));
  const fallback = String(def ?? options[0]);
  if (sized.length < 2) return fallback;
  const mid = sized[Math.floor((sized.length - 1) / 2)];
  const d = resolutionRank(def);
  return Number.isFinite(d) && d <= resolutionRank(mid) ? fallback : String(mid);
}

/**
 * The size closest to `target` without going over it (a reference sheet prefers 2K; a 1K-only model gets 1K), else
 * the smallest offered; undefined when no option is a size.
 */
export function preferredResolution(options: Array<string | number>, target: string): string | undefined {
  const t = resolutionRank(target);
  const sized = options.filter((o) => Number.isFinite(resolutionRank(o))).sort((a, b) => resolutionRank(a) - resolutionRank(b));
  if (!sized.length) return undefined;
  const under = sized.filter((o) => resolutionRank(o) <= t);
  return String(under.length ? under[under.length - 1] : sized[0]);
}

// Quality values above "medium" that a model may default to (fal GPT Image defaults to "high").
const ABOVE_MEDIUM = new Set(['auto', 'high', 'xhigh', 'max']);

/**
 * Medium quality by default (PLAN_PROMPTING.md §3, like resolution in R1): an image model whose `quality` enum
 * offers "medium" but defaults higher gets "medium" (GPT Image on fal, Grok Imagine quality edit). Quality can
 * multiply the price; the user can still raise it in Advanced.
 */
export function mediumQuality(schema: ModelSchema, kind: MediaKind): Record<string, AdvancedValue> {
  if (kind !== 'image') return {};
  const p = schema.params.find((x) => x.key === 'quality' && x.role === 'other' && x.type === 'enum');
  if (!p?.options?.includes('medium')) return {};
  return ABOVE_MEDIUM.has(String(p.default ?? 'auto')) ? { quality: 'medium' } : {};
}

/**
 * Ideogram's Magic Prompt (`expand_prompt`, on by default on fal) rewrites the prompt. Off when the prompt is JSON or
 * carries literal text in quotes, which must reach the model as written (PLAN_PROMPTING.md §3), unless the user set it.
 */
export function promptExpansion(schema: ModelSchema, settings: GenSettings, prompt: string | undefined): Record<string, boolean> {
  const p = schema.params.find((x) => x.key === 'expand_prompt' && x.type === 'boolean');
  if (!p || p.default === false || settings.advanced.expand_prompt !== undefined || !prompt) return {};
  const t = prompt.trim();
  return t.startsWith('{') || /["“][^"”\n]+["”]/.test(t) ? { expand_prompt: false } : {};
}

export function defaultSettings(schema: ModelSchema | undefined, kind: MediaKind): GenSettings {
  const s: GenSettings = { count: 1, advanced: {} };
  if (!schema) return s;
  s.advanced = mediumQuality(schema, kind);
  const aspect = paramByRole(schema, 'aspect');
  if (aspect?.options?.length) {
    const preferred = kind === 'video' ? '16:9' : '1:1';
    const def = typeof aspect.default !== 'boolean' && aspect.default !== aspect.omit ? aspect.default : undefined;
    s.aspect = nearestAspect(aspect.options.filter((o) => !isAutoOption(o)), preferred, def) ?? String(aspect.default ?? aspect.options[0]);
  }
  const res = paramByRole(schema, 'resolution');
  if (res?.options?.length) s.resolution = kind === 'video' ? mediumResolution(res.options, res.default) : String(res.default ?? res.options[0]);
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
  const out: GenSettings = { ...base, count: Math.max(1, Math.min(8, Math.round(input.count ?? 1))), advanced: { ...base.advanced } };
  if (!schema) return { settings: { ...out, seed: input.seed }, changes };

  const aspect = paramByRole(schema, 'aspect');
  if (aspect?.options?.length && input.aspect != null) {
    const exact = aspect.options.find((o) => String(o) === String(input.aspect));
    const near = exact != null ? String(exact) : nearestAspect(aspect.options, input.aspect, base.aspect);
    if (near) {
      out.aspect = near;
      // Only a real change is noted: "1776x2368" and "1776*2368" are the same size.
      const same = (v: unknown) => String(v).toLowerCase().replace(/[×*]/g, 'x').replace(/\s+/g, '');
      if (same(near) !== same(input.aspect)) changes.push(`aspect ${input.aspect} → ${aspectLabel(near)}`);
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
  for (const p of schema.params.filter((x) => STRUCTURED_TYPES.has(x.type))) {
    const v = normalizeStructured(p, input.extras?.[p.key]);
    if (v !== undefined) extras[p.key] = v;
  }
  if (Object.keys(extras).length) out.extras = extras;

  for (const [k, v] of Object.entries(input.advanced ?? {})) {
    const def = schema.params.find((p) => p.key === k && p.role === 'other');
    // Structured values (lyrics, colors…) live in extras, never in advanced.
    if (!def || STRUCTURED_TYPES.has(def.type)) continue;
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
        if (STRUCTURED_TYPES.has(p.type)) {
          const v = structuredWire(p, settings.extras?.[p.key]);
          if (v !== undefined) out[p.key] = v;
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
