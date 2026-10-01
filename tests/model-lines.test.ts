import { describe, expect, it } from 'vitest';
import { lineKey, variantRoute } from '../src/engine/variants';
import type { ModelSummary } from '../src/engine/types';

const m = (ref: string, kind: 'image' | 'video', extra: Partial<ModelSummary> = {}) => {
  const [provider, id] = ref.split('::');
  return { ref, provider, id, kind, name: id, tags: [], acceptsImage: false, ...extra } as unknown as ModelSummary;
};

describe('model lines', () => {
  it('groups the input routes of one model, and keeps tiers apart', () => {
    const t2i = m('atlas::google/nano-banana-2-lite/text-to-image', 'image');
    const edit = m('atlas::google/nano-banana-2-lite/edit', 'image', { acceptsImage: true });
    const ref = m('atlas::google/nano-banana-2-lite/reference-to-image', 'image', { acceptsImage: true });
    const pro = m('atlas::google/nano-banana-pro/edit', 'image');
    expect(lineKey(edit)).toBe(lineKey(t2i));
    expect(lineKey(ref)).toBe(lineKey(t2i));
    expect(lineKey(pro)).not.toBe(lineKey(t2i));
    expect([variantRoute(t2i), variantRoute(edit), variantRoute(ref)]).toEqual(['text', 'edit', 'reference']);
  });
  it('video routes: text, image and reference to video in one line', () => {
    const ids = ['atlas::alibaba/wan-3.0/text-to-video', 'atlas::alibaba/wan-3.0/image-to-video', 'atlas::alibaba/wan-3.0/reference-to-video'];
    const ms = ids.map((r) => m(r, 'video'));
    expect(new Set(ms.map(lineKey)).size).toBe(1);
    expect(ms.map(variantRoute)).toEqual(['text', 'image', 'reference']);
    expect(lineKey(m('atlas::alibaba/wan-3.0-prime/text-to-video', 'video'))).not.toBe(lineKey(ms[0]));
    // fal spells the tier as a path segment: still the same line as Atlas
    expect(lineKey(m('fal::bytedance/seedance-2.0/fast/image-to-video', 'video'))).toBe(lineKey(m('atlas::bytedance/seedance-2.0-fast/text-to-video', 'video')));
  });
});
