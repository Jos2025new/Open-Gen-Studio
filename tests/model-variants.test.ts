import { describe, expect, it } from 'vitest';
import { groupVariants, variantKey } from '../src/engine/variants';
import type { ModelSummary, ProviderId } from '../src/engine/types';

const mk = (ref: string, usd?: number, unit: 'output' | 'megapixel' = 'output'): ModelSummary => {
  const [provider, id] = ref.split('::') as [ProviderId, string];
  return { ref, provider, id, name: id, kind: 'image', acceptsText: true, acceptsImage: false, tags: [], price: usd == null ? undefined : { skus: [{ usd, unit }] } } as unknown as ModelSummary;
};
const key = (ref: string) => variantKey(mk(ref));

describe('model variants across providers (ids from the live snapshot)', () => {
  it('the same variant has the same key on every provider', () => {
    expect(key('atlas::google/nano-banana-pro/edit')).toBe(key('fal::fal-ai/nano-banana-pro/edit'));
    expect(key('atlas::google/nano-banana-pro/edit')).toBe(key('nanogpt::nano-banana-pro-edit'));
    expect(key('atlas::google/nano-banana-pro/text-to-image')).toBe(key('nanogpt::nano-banana-pro'));
    expect(key('atlas::bytedance/seedream-v5.0-pro/text-to-image')).toBe(key('fal::bytedance/seedream/v5/pro/text-to-image'));
    expect(key('atlas::openai/gpt-image-2.5-flare-developer/edit')).toBe(key('fal::openai/gpt-image-2.5/flare/edit'));
    expect(key('fal::fal-ai/recraft/v4.1/pro/text-to-image')).toBe(key('nanogpt::recraft-ai/recraft-v4.1-pro/text-to-image'));
  });

  it('different variants stay apart', () => {
    expect(key('atlas::google/nano-banana-pro/edit')).not.toBe(key('atlas::google/nano-banana-pro/text-to-image'));
    expect(key('atlas::google/nano-banana-pro/edit')).not.toBe(key('atlas::google/nano-banana-pro/edit-ultra'));
    expect(key('atlas::google/nano-banana-2/text-to-image')).not.toBe(key('atlas::google/nano-banana-pro/text-to-image'));
    expect(key('fal::fal-ai/z-image/turbo')).not.toBe(key('fal::fal-ai/z-image/turbo/image-to-image'));
    expect(key('fal::fal-ai/recraft/v4.1/text-to-image')).not.toBe(key('fal::fal-ai/recraft/v4.1/text-to-vector'));
  });

  it('picks the cheapest provider with a comparable price', () => {
    const order: ProviderId[] = ['atlas', 'fal', 'nanogpt'];
    const [g] = groupVariants([mk('atlas::google/nano-banana-pro/edit', 0.14), mk('nanogpt::nano-banana-pro-edit', 0.12), mk('fal::fal-ai/nano-banana-pro/edit')], order);
    expect(g.best.ref).toBe('nanogpt::nano-banana-pro-edit');
    expect(g.members.map((m) => m.provider)).toEqual(['nanogpt', 'atlas', 'fal']);
    // Different units cannot be compared: provider order decides.
    const [h] = groupVariants([mk('atlas::z-image/turbo', 0.02, 'megapixel'), mk('fal::fal-ai/z-image/turbo', 0.01)], order);
    expect(h.best.provider).toBe('atlas');
  });
});
