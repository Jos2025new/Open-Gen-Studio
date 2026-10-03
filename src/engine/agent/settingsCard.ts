import { estimateMedia } from '../costs';
import { aspectLabel, durationChoices, isAutoOption, mediumResolution, nearestAspect, paramByRole, pixelSizes } from '../params';
import { routeFits, routeMode, routeVideo, VIDEO_ROUTES, type VideoPurpose } from '../routing';
import type { Estimate, ModelSchema, ModelSummary, SettingsChoice, SettingsFeedItem, SettingsSection } from '../types';

/*
 * Phase 2 (settings before prompts): the agent says what the plan will make; the app picks the recommended model
 * the same way a plan would (the user's own pick, else the purpose table or the default), offers a few others that
 * take the same inputs, and the values each model really has. The user confirms before any prompt is written.
 */

export interface SettingsRequest {
  kind: 'video' | 'image';
  purpose: VideoPurpose;
  /** A start image (video) or reference/source images. */
  startImage: boolean;
  refs: number;
  count: number;
  duration?: number;
  aspect?: string;
  /** A model the user named, or one of the short list (image by task). */
  model?: string;
}

type Resolve = (ref: string) => Promise<{ model: ModelSummary; schema: ModelSchema } | null>;

export interface SettingsDeps {
  getModel: Resolve;
  suggestModel: (name: string, kind: 'video' | 'image', needsImage: boolean) => string | undefined;
  composerChosen: (kind: 'video' | 'image') => boolean;
  routeModel: (mode: 'text' | 'image' | 'reference') => string | undefined;
  defaultModel: (kind: 'video' | 'image', needsImage: boolean) => string | null;
}

/** The short list the agent may pick from without being asked (system prompt, "Image by task"). */
const IMAGE_FAMILIES = ['GPT Image 2', 'Nano Banana 2', 'Seedream 5', 'Recraft', 'Ideogram'];
/** Cheaper picks, so the card always has an economical option (the ones offered when someone asks for cheaper). */
const IMAGE_BUDGET = ['Nano Banana 2 Lite', 'Z-Image', 'P-Image', 'Seedream 5 Lite'];
const MAX_ALTERNATIVES = 6;
const DURATION_STEPS = [4, 5, 6, 8, 10, 12, 15, 20, 30];

export interface SettingsOptions {
  resolutions: string[];
  durations: number[];
  /** Aspect values (wire) without "auto"-like ones; the card adds "match the image" when there is a start image. */
  aspects: string[];
  /** Sizes given as exact pixels (Seedream): a size tier plus a ratio, as the composer and the nodes show them. */
  px: ReturnType<typeof pixelSizes>;
}

export function settingsOptions(schema: ModelSchema | undefined, kind: 'video' | 'image'): SettingsOptions {
  const res = paramByRole(schema, 'resolution')?.options?.map(String) ?? [];
  const all = kind === 'video' ? durationChoices(schema).filter((d) => d > 0) : [];
  // A range (2–30 s) becomes a few usual lengths; a short list stays as is.
  const durations = all.length > 7 ? DURATION_STEPS.filter((d) => all.includes(d)) : all;
  const aspects = (paramByRole(schema, 'aspect')?.options ?? []).filter((o) => !isAutoOption(o)).map(String);
  return { resolutions: res, durations, aspects, px: pixelSizes(aspects) };
}

/** Images to generate per step: the composer's range. */
export const IMAGE_COUNTS = [1, 2, 3, 4];

/** The values a model starts with on the card: medium resolution, the asked length and shape snapped to what it has. */
export function defaultChoice(ref: string, schema: ModelSchema | undefined, req: Pick<SettingsRequest, 'kind' | 'duration' | 'aspect' | 'startImage'> & { count?: number }, prev?: SettingsChoice): SettingsChoice {
  const o = settingsOptions(schema, req.kind);
  const resParam = paramByRole(schema, 'resolution');
  const wantRes = prev?.resolution;
  const resolution = o.resolutions.length ? (wantRes && o.resolutions.includes(wantRes) ? wantRes : mediumResolution(o.resolutions, resParam?.default)) : undefined;
  const wantDur = prev?.duration ?? req.duration ?? Number(paramByRole(schema, 'duration')?.default ?? 5);
  // Snapped to every length the model takes (the card's chips are only a few of them).
  const secs = req.kind === 'video' ? durationChoices(schema).filter((d) => d > 0) : [];
  const duration = secs.length ? secs.reduce((a, b) => (Math.abs(b - wantDur) < Math.abs(a - wantDur) ? b : a)) : undefined;
  const wantAspect = prev ? prev.aspect : req.aspect;
  if (o.px) {
    // Exact pixel sizes (pixelSizes, as in the composer and the nodes): the medium size tier, or the one picked before, and the nearest ratio.
    const was = prev?.aspect ? pixelSizes([prev.aspect])?.of(prev.aspect) : undefined;
    const tier = was?.tier && o.px.tiers.includes(was.tier) ? was.tier : mediumResolution(o.px.tiers);
    const want = was?.ratio ?? (wantAspect ? aspectLabel(wantAspect) : undefined);
    const ratio = want ? nearestAspect(o.px.ratios, want) : req.startImage ? undefined : o.px.ratios[0];
    return { modelRef: ref, resolution, duration, aspect: ratio ? o.px.pick(tier, ratio) : undefined, needsImage: req.startImage || false, ...imageCount(req, prev) };
  }
  // With a start image and no asked shape, the clip keeps the image's (aspect left unset).
  const aspect = wantAspect && o.aspects.length ? nearestAspect(o.aspects, wantAspect) : req.startImage || !o.aspects.length ? undefined : String(paramByRole(schema, 'aspect')?.default ?? o.aspects[0]);
  return { modelRef: ref, resolution, duration, aspect, needsImage: req.startImage || false, ...imageCount(req, prev) };
}

function imageCount(req: { kind: string; count?: number }, prev?: SettingsChoice): { count?: number } {
  if (req.kind !== 'image') return {};
  const n = prev?.count ?? req.count ?? 1;
  return { count: Math.min(4, Math.max(1, Math.round(n))) };
}

export function choiceEstimate(choice: SettingsChoice, kind: 'video' | 'image', count: number): Estimate {
  const e = estimateMedia(choice.modelRef, kind, { count: kind === 'image' ? choice.count ?? 1 : 1, advanced: {}, resolution: choice.resolution, duration: choice.duration, aspect: choice.aspect }, choice.needsImage);
  return e.usd == null ? e : { ...e, usd: e.usd * Math.max(1, count) };
}

/** "16:9", or "2K 16:9" for an exact pixel size (the composer's tier + ratio). */
export function sizeName(aspect: string): string {
  const p = pixelSizes([aspect])?.of(aspect);
  return p?.ratio ? `${p.tier} ${p.ratio}` : aspectLabel(aspect);
}

/** "Seedance 2.0 Fast · 720p · 8 s · 9:16" (model name given by the caller). */
export function describeChoice(name: string, c: SettingsChoice): string {
  return [name, c.resolution, c.duration ? `${c.duration} s` : '', c.count ? `×${c.count}` : '', c.aspect ? sizeName(c.aspect) : c.needsImage ? 'shape of the image' : ''].filter(Boolean).join(' · ');
}

/** The recommended model and a few others for the card; an error the agent gets when nothing fits. */
export async function buildSettings(req: SettingsRequest, deps: SettingsDeps): Promise<{ recommended: SettingsChoice; alternatives: string[] } | { error: string }> {
  const needsImage = req.startImage || req.refs > 0;
  const mode = routeMode({ firstFrame: req.startImage && req.refs === 0, refs: req.refs });
  const fits = async (ref: string | undefined | null): Promise<boolean> => {
    if (!ref) return false;
    const r = await deps.getModel(ref);
    if (!r || r.model.kind !== req.kind || r.schema.missing?.length) return false;
    if (req.kind === 'video') return routeFits(r.model, r.schema, { mode, refs: req.refs, duration: req.duration });
    return !needsImage || Boolean(r.schema.slots.images);
  };
  const byName = (name: string) => (name.includes('::') ? name : deps.suggestModel(name, req.kind, needsImage));

  let recommended: string | undefined;
  if (req.model?.trim()) {
    const ref = byName(req.model.trim());
    if (!ref || !(await deps.getModel(ref))) return { error: `Unknown model "${req.model}". Call find_models, or leave "model" out for the recommended one.` };
    recommended = ref;
  } else if (req.kind === 'video') {
    const override = deps.routeModel(mode);
    if (override && (await fits(override))) recommended = override;
    else if (deps.composerChosen('video')) recommended = deps.defaultModel('video', needsImage) ?? undefined;
    else recommended = (await routeVideo(req.purpose, { firstFrame: mode === 'image', refs: req.refs, duration: req.duration }, deps.getModel))?.ref ?? deps.defaultModel('video', needsImage) ?? undefined;
  } else {
    recommended = deps.defaultModel('image', needsImage) ?? undefined;
  }
  if (!recommended) return { error: `No ${req.kind} model is available. Ask the user to connect a provider.` };

  // A few others: the purpose rows (video) or the short image list, only those that take these inputs.
  const candidates =
    req.kind === 'video'
      ? [...VIDEO_ROUTES[req.purpose], ...VIDEO_ROUTES.normal, ...VIDEO_ROUTES.draft, ...VIDEO_ROUTES.long].map((e) => e.refs[mode])
      : [...IMAGE_FAMILIES, ...IMAGE_BUDGET].map(byName);
  const alternatives: string[] = [];
  const seenNames = new Set<string>([(await deps.getModel(recommended))?.model.name ?? recommended]);
  for (const ref of candidates) {
    if (alternatives.length >= MAX_ALTERNATIVES) break;
    if (!ref || ref === recommended || alternatives.includes(ref) || !(await fits(ref))) continue;
    const name = (await deps.getModel(ref))?.model.name ?? ref;
    if (seenNames.has(name)) continue;
    seenNames.add(name);
    alternatives.push(ref);
  }
  const schema = (await deps.getModel(recommended))?.schema;
  return { recommended: { ...defaultChoice(recommended, schema, req), needsImage }, alternatives };
}

/** A card saved before sections existed (one kind: kind, count, recommended, alternatives, chosen) read as one section. */
export function sectionsOf(item: SettingsFeedItem): SettingsSection[] {
  if (Array.isArray(item.sections)) return item.sections;
  const old = item as unknown as Partial<SettingsSection>;
  return old.recommended ? [{ kind: old.kind ?? 'video', count: old.count ?? 1, recommended: old.recommended, alternatives: old.alternatives ?? [], chosen: old.chosen }] : [];
}
