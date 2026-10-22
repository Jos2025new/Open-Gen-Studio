import { describe, expect, it } from 'vitest';
import { bodyBytes, fitBody, SHRINK_STEPS, type ShrinkStep } from '../src/engine/providers/bodyBudget';

/*
 * NanoGPT's host refuses a body over 4.5 MB (413 FUNCTION_PAYLOAD_TOO_LARGE): three ~1.5 MB PNG references to
 * Wan 3.0 reference-to-video failed that way in the sandbox on 2026-10-21. The body is fitted before it is sent.
 */
const img = (kb: number, tag = 'x') => `data:image/png;base64,${tag.repeat(kb * 1000)}`;
// A fake re-encode: the size follows the step, the tag keeps track of which original it came from.
const fake = (url: string, step: ShrinkStep) => Promise.resolve(`data:image/jpeg;base64,${url.slice(22, 23).repeat(Math.round(step.maxSide / 10))}`);

describe('NanoGPT request body budget', () => {
  it('leaves a body under the limit exactly as it is', async () => {
    const body = { prompt: 'p', referenceImages: [img(1), img(1)] };
    const copy = JSON.parse(JSON.stringify(body));
    expect(await fitBody(body, 10_000, fake)).toBeUndefined();
    expect(body).toEqual(copy);
  });

  it('re-encodes every image from its original until the body fits, keeping order', async () => {
    const body = { prompt: 'p', imageDataUrl: img(3, 'a'), referenceImages: [img(3, 'b'), img(3, 'c')] };
    const step = await fitBody(body, 500, fake);
    expect(step).toEqual(SHRINK_STEPS[2]);
    expect(bodyBytes(body)).toBeLessThanOrEqual(500);
    expect(body.imageDataUrl).toMatch(/^data:image\/jpeg;base64,a+$/);
    expect(body.referenceImages.map((u) => u.slice(-1))).toEqual(['b', 'c']);
  });

  it('keeps an original that is already smaller than its re-encode', async () => {
    const small = 'data:image/jpeg;base64,s';
    const body = { a: small, b: img(5) };
    await fitBody(body, 1000, fake);
    expect(body.a).toBe(small);
  });

  it('never touches a mask, and stops before sending when even the smallest step does not fit', async () => {
    const mask = img(5, 'm');
    const body = { mask, referenceImages: [img(5)] };
    await expect(fitBody(body, 1000, fake)).rejects.toThrow(/NanoGPT accepts up to 4\.5 MB.*Nothing was sent or charged/);
    expect(body.mask).toBe(mask);
  });
});
