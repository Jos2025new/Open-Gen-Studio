import { estimate, sumEstimates, FREE, UNKNOWN } from './pricing';
import { longEdgeFor, ratioOf } from './params';
import { OPS, opCount } from './ops';
import { opModelFor } from './catalog';
import type { AdvancedValue, Asset, Estimate, GenSettings, MediaKind, OpId, PriceRule } from './types';
import { useStore } from '../store/store';

const get = useStore.getState;

export function priceOf(ref: string): PriceRule | undefined {
  const c = get().catalog;
  return c.schemas[ref]?.price ?? c.models[ref]?.price;
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
  if (kind === 'image') {
    return estimate(price, { count: settings.count, resolution: settings.resolution, mode: withImage ? 'image' : 'text', megapixels: megapixels(settings) });
  }
  return estimate(price, {
    count: settings.count,
    duration: settings.duration,
    resolution: settings.resolution,
    audio: settings.audio,
    mode: withImage ? 'image' : 'text',
  });
}

export function estimateOp(opId: OpId, params: Record<string, AdvancedValue>, source: Pick<Asset, 'width' | 'height'> | undefined, videoSettings: GenSettings): Estimate {
  const def = OPS[opId];
  if (def.engine === 'local') return FREE;
  const { ref } = opModelFor(def.engine);
  if (ref.startsWith('local::')) return FREE;
  const price = priceOf(ref);
  if (!price) return UNKNOWN;
  if (def.engine === 'video') {
    return estimate(price, { count: 1, duration: videoSettings.duration, resolution: videoSettings.resolution, audio: videoSettings.audio, mode: 'image' });
  }
  const count = opCount(def, params);
  let mp = source ? (source.width * source.height) / 1_000_000 : 1;
  if (opId === 'upscale') mp *= Number(params.factor) === 4 ? 16 : 4;
  return estimate(price, { count, megapixels: mp, mode: 'image' });
}

export { sumEstimates };
