import { describe, expect, it } from 'vitest';
import { nanoVideoInputs } from '../src/engine/providers/nanogpt';

const v = (id: string, capabilities?: Record<string, boolean>) => ({ id, capabilities }) as Parameters<typeof nanoVideoInputs>[0];

describe('NanoGPT video catalog keeps unknown capabilities', () => {
  it('explicit flags win', () => {
    expect(nanoVideoInputs(v('a', { text_to_video: true }))).toMatchObject({ text: true, image: false, unknown: false });
    expect(nanoVideoInputs(v('a', { text_to_video: false, image_to_video: false }))).toBeNull();
  });
  it('models with no flags are kept and inferred from the id', () => {
    expect(nanoVideoInputs(v('acme/clip-i2v'))).toMatchObject({ text: false, image: true, unknown: true });
    expect(nanoVideoInputs(v('acme/clip-text-to-video'))).toMatchObject({ text: true, image: false, unknown: true });
    expect(nanoVideoInputs(v('acme/new-video'))).toMatchObject({ text: true, image: false, unknown: true });
  });
});
