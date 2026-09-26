import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { guideIndex, readGuide } from '../src/engine/skills';
import { guideForModel } from '../src/engine/guides';
import { describeIndexed } from '../src/engine/agent/modelIndex';

describe('Wan 3 guide', () => {
  it('is indexed, covers Wan 3.0 and Prime, and cites references without @', () => {
    expect(guideIndex()).toContain('  model:wan — how to write prompts for Wan 3.0 / Wan 3.0 Prime');
    for (const id of ['alibaba/wan-3.0/reference-to-video', 'alibaba/wan-3.0-prime/image-to-video']) expect(guideForModel(id)?.id).toBe('wan');
    const t = readGuide('model:wan')!;
    for (const rule of ['Image 1', 'exclusive', '47°', 'First frame', 'Prime is the premium route', 'one medium', 'enable_thinking']) expect(t).toContain(rule);
    expect(t).not.toMatch(/@Image/);
  });
});

describe('model prompting guides', () => {
  it('lists Seedance in the index with one short line, and loads it by id', () => {
    const line = guideIndex().split('\n').find((l) => l.includes('model:seedance'));
    expect(line).toBe('  model:seedance — how to write prompts for Seedance 2.0 / 2.5');
    const text = readGuide('model:seedance')!;
    expect(text).toMatch(/Seedance 2\.0 \/ 2\.5/);
    expect(readGuide('model:nope')).toBeUndefined();
  });

  it('carries the production rules, adapted to our providers', () => {
    const t = readGuide('model:seedance')!;
    for (const rule of ['PLATE comes first', 'Hard cut.', 'Count of', 'No music, no score, no bgm', '@Image1', 'STYLE FORMULA', 'animated on twos', 'Edit: describe only the change', '4–30 s']) {
      expect(t).toContain(rule);
    }
    // Higgsfield-only features stay out: element tokens and 4K on Seedance.
    expect(t).not.toMatch(/<<<element/);
    expect(t).not.toMatch(/\b4K\b/);
  });

  it('matches every Seedance variant and points find_models results to the guide', () => {
    for (const id of ['bytedance/seedance-2.5/reference-to-video', 'bytedance-seedance-2-0-fast', 'bytedance/seedance-2.0/fast/image-to-video']) expect(guideForModel(id)?.id).toBe('seedance');
    expect(guideForModel('minimax/h3/text-to-video')).toBeUndefined();
    const line = describeIndexed({ ref: 'nanogpt::bytedance-seedance-2-0-fast', provider: 'nanogpt', id: 'bytedance-seedance-2-0-fast', name: 'Seedance 2.0 Fast', kind: 'video', acceptsText: true, acceptsImage: true, tags: [] });
    expect(line).toContain('prompting guide: model:seedance');
  });
});
