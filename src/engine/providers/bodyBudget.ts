import { blobToDataUrl, dataUrlToBlob, recompressImage } from '../../lib/media';

/**
 * NanoGPT's API host (nano-gpt.com) runs on Vercel, which refuses a request body over 4.5 MB with
 * 413 FUNCTION_PAYLOAD_TOO_LARGE (vercel.com/docs/functions/limitations). Images go inline as base64, so three
 * ~1.5 MB PNG references already pass it. Kept under with a margin.
 */
export const NANOGPT_BODY_LIMIT = 4_000_000;

export interface ShrinkStep {
  maxSide: number;
  quality: number;
}

/** Tried in order, each from the original image: first only re-encoded as JPEG, then smaller. */
export const SHRINK_STEPS: ShrinkStep[] = [
  { maxSide: 2048, quality: 0.9 },
  { maxSide: 1536, quality: 0.85 },
  { maxSide: 1024, quality: 0.8 },
];

export function bodyBytes(body: unknown): number {
  return new TextEncoder().encode(JSON.stringify(body)).length;
}

const mb = (n: number) => (n / 1_000_000).toFixed(1);

async function shrinkDataUrl(url: string, step: ShrinkStep): Promise<string> {
  return blobToDataUrl(await recompressImage(dataUrlToBlob(url), step.maxSide, step.quality));
}

/**
 * Under the limit, the body is left as it is. Over it, every inline image (top-level fields and arrays; masks keep
 * their transparency and are never touched) is re-encoded from its original, step by step, until the body fits; a
 * smaller original is kept as is. If even the last step does not fit, nothing is sent: the error says why.
 * Returns the step used, or undefined when nothing changed.
 */
export async function fitBody(body: Record<string, unknown>, limit: number, shrink: (url: string, step: ShrinkStep) => Promise<string> = shrinkDataUrl): Promise<ShrinkStep | undefined> {
  const before = bodyBytes(body);
  if (before <= limit) return undefined;
  const isImage = (v: unknown): v is string => typeof v === 'string' && v.startsWith('data:image/');
  const slots: Array<{ key: string; index?: number; original: string }> = [];
  for (const [key, v] of Object.entries(body)) {
    if (/mask/i.test(key)) continue;
    if (isImage(v)) slots.push({ key, original: v });
    else if (Array.isArray(v)) v.forEach((x, index) => isImage(x) && slots.push({ key, index, original: x }));
  }
  const hasAudio = Object.entries(body).some(([key, value]) => /audio/i.test(key) && typeof value === 'string' && value.startsWith('data:audio/'));
  const tooLarge = (now: number) => new Error(!slots.length && hasAudio
    ? `The audio input makes the request ${mb(now)} MB; the app request-body budget is 4 MB. Shorten the audio. Nothing was sent or charged.`
    : `The request to NanoGPT is ${mb(now)} MB and NanoGPT accepts up to 4.5 MB${slots.length ? ', even with the images reduced to 1024 px' : ''}. Nothing was sent or charged. Use fewer or lighter input images.`);
  if (!slots.length) throw tooLarge(before);
  for (const step of SHRINK_STEPS) {
    for (const s of slots) {
      const small = await shrink(s.original, step);
      const value = small.length < s.original.length ? small : s.original;
      if (s.index === undefined) body[s.key] = value;
      else (body[s.key] as unknown[])[s.index] = value;
    }
    if (bodyBytes(body) <= limit) return step;
  }
  throw tooLarge(bodyBytes(body));
}
