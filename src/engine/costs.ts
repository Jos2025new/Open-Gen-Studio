import { estimate, sumEstimates, FREE, UNKNOWN } from './pricing';
import { durationChoices, longEdgeFor, ratioOf } from './params';
import { OPS, opCount } from './ops';
import { opModelFor } from './catalog';
import type { AdvancedValue, Asset, Estimate, GenSettings, MediaKind, OpId, PriceRule } from './types';
import { useStore } from '../store/store';
import { parseModelRef } from './providers/types';
import { variant3dKey } from '../lib/model3d';

const get = useStore.getState;

export function priceOf(ref: string): PriceRule | undefined {
  const c = get().catalog;
  return c.schemas[ref]?.price ?? c.models[ref]?.price;
}

/** Longest duration a model accepts, to price an automatic (-1) duration. */
function maxDuration(ref: string): number | undefined {
  const d = durationChoices(get().catalog.schemas[ref]).filter((n) => n > 0);
  return d.length ? Math.max(...d) : undefined;
}

function megapixels(settings: GenSettings): number {
  const long = longEdgeFor(settings.resolution ?? settings.aspect);
  const r = ratioOf(settings.aspect) ?? 1;
  const short = r >= 1 ? long / r : long * r;
  return (long * short) / 1_000_000;
}

export function estimateMedia(ref: string, kind: MediaKind, settings: GenSettings, withImage: boolean): Estimate {
  if (ref.startsWith('local::')) return FREE;
  const price = priceOf(ref);
  if (!price) return UNKNOWN;
  if (kind === 'model3d') {
    const parsed = parseModelRef(ref);
    const key = price.variants && parsed ? variant3dKey(parsed.id, { ...settings.advanced, ...(settings.resolution ? { resolution: settings.resolution } : {}) }) : undefined;
    const usd = key != null ? price.variants?.[key] : undefined;
    if (usd != null) return { usd: usd * Math.max(1, settings.count), approximate: false, note: price.note };
    return estimate(price, { count: settings.count, mode: withImage ? 'image' : 'text' });
  }
  if (kind === 'image') {
    return estimate(price, { count: settings.count, resolution: settings.resolution, mode: withImage ? 'image' : 'text', megapixels: megapixels(settings) });
  }
  return estimate(price, {
    count: settings.count,
    duration: settings.duration,
    maxDuration: maxDuration(ref),
    resolution: settings.resolution,
    audio: settings.audio,
    mode: withImage ? 'image' : 'text',
  });
}

/** Speech-to-text is billed per minute of audio (NanoGPT catalog). Short clips still bill a minimum second. */
export function estimateTranscribe(usdPerMinute: number | undefined, seconds: number | undefined): Estimate {
  if (usdPerMinute == null) return UNKNOWN;
  const usd = (usdPerMinute * Math.max(seconds ?? 60, 1)) / 60;
  // A paid run never shows as free: amounts under the display precision count as the smallest step.
  const shown = usd > 0 ? Math.max(0.0001, Math.round(usd * 10000) / 10000) : 0;
  return { usd: shown, approximate: seconds == null || shown > usd, note: `${usdPerMinute} USD per minute` };
}

export function estimateOp(opId: OpId, params: Record<string, AdvancedValue>, source: Pick<Asset, 'width' | 'height'> | undefined, videoSettings: GenSettings): Estimate {
  const def = OPS[opId];
  if (def.engine === 'local') return FREE;
  const { ref } = opModelFor(def.engine);
  if (ref.startsWith('local::')) return FREE;
  const price = priceOf(ref);
  if (!price) return UNKNOWN;
  if (def.engine === 'video' || def.engine === 'video_upscale' || def.engine === 'video_edit' || def.engine === 'video_extend') {
    // For video-to-video, `duration` is the source clip's length (per-second prices scale with it).
    return estimate(price, { count: 1, duration: videoSettings.duration, maxDuration: maxDuration(ref), resolution: videoSettings.resolution, audio: videoSettings.audio, mode: 'image' });
  }
  const count = opCount(def, params);
  let mp = source ? (source.width * source.height) / 1_000_000 : 1;
  if (opId === 'upscale') mp *= Number(params.factor) === 4 ? 16 : 4;
  return estimate(price, { count, megapixels: mp, mode: 'image' });
}

export { sumEstimates };
