import type { ModelSchema, ModelSummary } from './types';
import { durationChoices } from './params';

/*
 * Video model by purpose (PLAN_ROUTING_COST.md, decided by the user 2026-09-26). The agent says what a video
 * step is for; the app picks the model: the first variant of the row that is connected and takes the step's
 * inputs. Rows list Atlas and NanoGPT only, each ordered by price at medium quality (720p / 768P), cheapest
 * first. Prices: PRECIOS_VIDEO.md (Atlas exact quotes via model/calculate, NanoGPT catalog). Any other model
 * (Seedance 2.5, Veo 3.1, HappyHorse 1.1, Grok 1.5, Gemini Omni, Kling) only when the user names it.
 */

export type VideoPurpose = 'draft' | 'normal' | 'long';
export const VIDEO_PURPOSES: VideoPurpose[] = ['draft', 'normal', 'long'];

/** Which variant a step needs: from text, from a start image, or with reference images. */
export type RouteMode = 'text' | 'image' | 'reference';

export interface RouteEntry {
  name: string;
  /** Model refs per input mode; a missing mode means the variant does not exist on that provider. */
  refs: Partial<Record<RouteMode, string>>;
  /** USD per second at medium quality, for reading the order (unset: not checked); the app shows the provider's own price. */
  usdPerSecond?: number;
}

const h3MaxTurboAtlas: RouteEntry = { name: 'MiniMax H3 Max Turbo', usdPerSecond: 0.038, refs: { text: 'atlas::minimax/h3-max-turbo/text-to-video', image: 'atlas::minimax/h3-max-turbo/image-to-video' } };
const h3MaxTurboNano: RouteEntry = { name: 'MiniMax H3 Max Turbo', refs: { text: 'nanogpt::minimax/h3-max-turbo', image: 'nanogpt::minimax/h3-max-turbo' } };
const h3DevAtlas: RouteEntry = {
  name: 'MiniMax H3 Developer',
  usdPerSecond: 0.024,
  refs: { text: 'atlas::minimax/h3-developer/text-to-video', image: 'atlas::minimax/h3-developer/image-to-video', reference: 'atlas::minimax/h3-developer/reference-to-video' },
};
const seedanceFastAtlas: RouteEntry = {
  name: 'Seedance 2.0 Fast',
  usdPerSecond: 0.0585,
  refs: { text: 'atlas::bytedance/seedance-2.0-fast/text-to-video', image: 'atlas::bytedance/seedance-2.0-fast/image-to-video', reference: 'atlas::bytedance/seedance-2.0-fast/reference-to-video' },
};
const seedanceFastNano: RouteEntry = { name: 'Seedance 2.0 Fast', usdPerSecond: 0.071, refs: { text: 'nanogpt::bytedance-seedance-2-0-fast', image: 'nanogpt::bytedance-seedance-2-0-fast' } };
const wanAtlas: RouteEntry = {
  name: 'Wan 3.0',
  usdPerSecond: 0.08,
  refs: { text: 'atlas::alibaba/wan-3.0/text-to-video', image: 'atlas::alibaba/wan-3.0/image-to-video', reference: 'atlas::alibaba/wan-3.0/reference-to-video' },
};
const h3Nano: RouteEntry = { name: 'MiniMax H3', usdPerSecond: 0.13, refs: { text: 'nanogpt::minimax-h3', image: 'nanogpt::minimax-h3', reference: 'nanogpt::minimax-h3/reference-to-video' } };
const wanNano: RouteEntry = {
  name: 'Wan 3.0',
  usdPerSecond: 0.13,
  refs: { text: 'nanogpt::alibaba/wan-3.0/text-to-video', image: 'nanogpt::alibaba/wan-3.0/image-to-video', reference: 'nanogpt::alibaba/wan-3.0/reference-to-video' },
};

export const VIDEO_ROUTES: Record<VideoPurpose, RouteEntry[]> = {
  draft: [h3MaxTurboAtlas, h3MaxTurboNano],
  normal: [h3DevAtlas, seedanceFastAtlas, seedanceFastNano, wanAtlas, h3Nano, wanNano],
  // Takes over 15 s (up to 30 s): Seedance 2.0 Fast stops at 15 s.
  long: [wanAtlas, wanNano],
};

export function routeMode(inputs: { firstFrame: boolean; refs: number }): RouteMode {
  return inputs.refs > 0 ? 'reference' : inputs.firstFrame ? 'image' : 'text';
}

/** Whether a model can run this step: its inputs, how many references and the requested length. */
export function routeFits(
  model: ModelSummary,
  schema: ModelSchema,
  step: { mode: RouteMode; refs: number; duration?: number },
): boolean {
  if (schema.missing?.length) return false;
  if (step.mode === 'text' && !model.acceptsText) return false;
  if (step.mode === 'image' && !(schema.slots.firstFrame || schema.slots.images || schema.slots.mixedRefs)) return false;
  if (step.mode === 'reference') {
    const max = schema.slots.images?.max ?? schema.slots.mixedRefs?.max ?? 0;
    if (max < step.refs) return false;
  }
  if (step.duration && step.duration > 0) {
    const choices = durationChoices(schema).filter((d) => d > 0);
    if (choices.length && Math.max(...choices) < step.duration) return false;
  }
  return true;
}

/**
 * The model for a video step: the first entry of its purpose row that the catalog has (connected provider) and
 * that fits the step; a draft that fits nothing falls back to the normal row. Undefined: nothing fits, the
 * caller uses the composer's model.
 */
export async function routeVideo(
  purpose: VideoPurpose,
  step: { firstFrame: boolean; refs: number; duration?: number },
  getModel: (ref: string) => Promise<{ model: ModelSummary; schema: ModelSchema } | null>,
): Promise<{ ref: string; entry: RouteEntry } | undefined> {
  const mode = routeMode(step);
  const rows = purpose === 'draft' ? [...VIDEO_ROUTES.draft, ...VIDEO_ROUTES.normal] : VIDEO_ROUTES[purpose];
  for (const entry of rows) {
    const ref = entry.refs[mode];
    if (!ref) continue;
    const resolved = await getModel(ref);
    if (resolved && routeFits(resolved.model, resolved.schema, { mode, refs: step.refs, duration: step.duration })) return { ref, entry };
  }
  return undefined;
}

/** First entry of a row the catalog has, for naming the default model in the agent's context (sync, no schema). */
export function routeHead(purpose: VideoPurpose, has: (ref: string) => boolean): RouteEntry | undefined {
  return VIDEO_ROUTES[purpose].find((e) => Object.values(e.refs).some((r) => r && has(r)));
}
