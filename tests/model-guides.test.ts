import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { guideIndex, readGuide } from '../src/engine/skills';
import { guideForModel } from '../src/engine/guides';
import { describeIndexed } from '../src/engine/agent/modelIndex';
import { refMentionStyle } from '../src/engine/params';

describe('video edit guidelines', () => {
  it('is indexed for any model, with the three-layer rule and the edit model choice', () => {
    expect(guideIndex()).toContain('  model:video-edit — how to write prompts for video edit and extend (any model)');
    const t = readGuide('model:video-edit')!;
    for (const rule of ['Imperative instruction', 'Say what stays the same', 'STYLE LOCK', 'Separate references by ROLE', 'Kling O3 edit', '<IMAGE_REF_0>', 'FLUX 3 Video Edit']) expect(t).toContain(rule);
    expect(guideForModel('google/gemini-omni-1.1-flash/video-edit')?.id).not.toBe('video-edit');
    expect(refMentionStyle('google/gemini-omni-1.1-flash/video-edit')).toEqual({ template: '<IMAGE_REF_{n}>', zeroBased: true });
  });
});

describe('Kling 3.0 guide', () => {
  it('covers V3 tiers (not O3), structured shots and subjects as elements', () => {
    expect(guideIndex()).toContain('  model:kling — how to write prompts for Kling 3.0 (std, pro, 4K, turbo)');
    for (const id of ['kwaivgi/kling-v3.0-pro/text-to-video', 'kwaivgi/kling-v3.0-std/image-to-video', 'fal-ai/kling-video/v3/pro/text-to-video', 'kling-v30-pro']) expect(guideForModel(id)?.id).toBe('kling');
    expect(guideForModel('fal-ai/kling-video/o3/pro/text-to-video')).toBeUndefined();
    const t = readGuide('model:kling')!;
    for (const rule of ['3–15 s', '2 500 characters', '`shots`', 'ONE clip', '@Name', 'At 0s, Ana (left)', 'number-one failure']) expect(t).toContain(rule);
  });
});

describe('FLUX 3 guide', () => {
  it('covers the video routes (not the robotics model) with audio on and edit as a change instruction', () => {
    expect(guideIndex()).toContain('  model:flux — how to write prompts for FLUX 3 Video and Video Edit');
    for (const id of ['black-forest-labs/flux-3/keyframes-to-video', 'blackforestlabs/flux-3/edit-video', 'blackforestlabs/flux-3/text-to-video/draft', 'flux-3']) expect(guideForModel(id)?.id).toBe('flux');
    expect(guideForModel('fal-ai/flux-3-action/so101')).toBeUndefined();
    const t = readGuide('model:flux')!;
    for (const rule of ['5–20 s', 'Audio is on by default', 'change instruction', 'on twos', 'do not describe the style again', 'quality "draft"', 'DRAFT → FINAL']) expect(t).toContain(rule);
  });
});

describe('Veo 3.1 guide', () => {
  it('covers every variant and states the 8 s limit, audio switch and moderation', () => {
    expect(guideIndex()).toContain('  model:veo — how to write prompts for Veo 3.1 (standard, Fast, Lite)');
    for (const id of ['google/veo3.1/reference-to-video', 'google/veo3.1-fast/text-to-video', 'fal-ai/veo3.1/lite/image-to-video', 'google/veo-3.1-fast']) expect(guideForModel(id)?.id).toBe('veo');
    const t = readGuide('model:veo')!;
    for (const rule of ['4 / 6 / 8 s', 'always 8 s', 'off by default on Atlas', 'Strict moderation', 'photoreal by default', 'repeat it at the end']) expect(t).toContain(rule);
  });
});

describe('HappyHorse guide', () => {
  it('covers 1.0, 1.1 and fal, one continuous shot, audio only where the variant makes it', () => {
    expect(guideIndex()).toContain('  model:happyhorse — how to write prompts for HappyHorse 1.0 / 1.1');
    for (const id of ['alibaba/happyhorse-1.1/reference-to-video', 'alibaba/happyhorse-1.0/text-to-video', 'alibaba/happy-horse/image-to-video']) expect(guideForModel(id)?.id).toBe('happyhorse');
    const t = readGuide('model:happyhorse')!;
    for (const rule of ['1–9 reference images', '2 500 characters', 'native on fal', 'One continuous shot', 'do not invent one', 'no CGI']) expect(t).toContain(rule);
  });
});

describe('Grok Imagine Video guide', () => {
  it('covers v1 and 1.5, cites <IMAGE_0> from zero unless the schema says otherwise', () => {
    expect(guideIndex()).toContain('  model:grok — how to write prompts for Grok Imagine Video (v1 and 1.5)');
    for (const id of ['xai/grok-imagine-video/reference-to-video', 'xai/grok-imagine-video-v1.5/text-to-video', 'grok-imagine-video']) expect(guideForModel(id)?.id).toBe('grok');
    const t = readGuide('model:grok')!;
    for (const rule of ['best instruction following', '<IMAGE_0>', 'Audio:', 'keep the composition and motion', 'first sentence', 'no three-dimensional volume']) expect(t).toContain(rule);
    expect(refMentionStyle('xai/grok-imagine-video/reference-to-video')).toEqual({ template: '<IMAGE_{n}>', zeroBased: true });
    // fal v1 declares @Image1 in its schema: the schema wins.
    expect(refMentionStyle('xai/grok-imagine-video/reference-to-video', 'Use @Image1, @Image2')?.template).toBe('@Image{n}');
  });
});

describe('MiniMax H3 guide', () => {
  it('covers every tier on our providers, with MiniMax reference labels and a declared style', () => {
    expect(guideIndex()).toContain('  model:minimax — how to write prompts for MiniMax H3 (all tiers)');
    for (const id of ['minimax/h3/reference-to-video', 'minimax/h3-max/image-to-video', 'minimax/h3-fast/text-to-video', 'minimax-h3']) expect(guideForModel(id)?.id).toBe('minimax');
    const t = readGuide('model:minimax')!;
    for (const rule of ['<Picture 1>', 'one continuous take', 'non_diegetic_music:N/A', 'subject_definitions:', 'retention_analysis:', 'At 00:02.000', 'leans strongly photoreal', 'H3 Developer', 'medium (768P)']) expect(t).toContain(rule);
    expect(t).not.toMatch(/@Image/);
  });
});

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
    expect(guideForModel('kwaivgi/kling-video-o3-pro/text-to-video')).toBeUndefined();
    const line = describeIndexed({ ref: 'nanogpt::bytedance-seedance-2-0-fast', provider: 'nanogpt', id: 'bytedance-seedance-2-0-fast', name: 'Seedance 2.0 Fast', kind: 'video', acceptsText: true, acceptsImage: true, tags: [] });
    expect(line).toContain('prompting guide: model:seedance');
  });
});

describe('image family guides (optional)', () => {
  it('each family matches its ids, is marked optional and loads with read_guide', () => {
    const cases: Array<[string, string]> = [
      ['nano-banana-pro-edit', 'nano-banana'],
      ['google/nano-banana-2/edit-developer', 'nano-banana'],
      ['openai/gpt-image-2.5-sunburst/edit', 'gpt-image'],
      ['bytedance/seedream-v5.0-pro', 'seedream'],
      ['ideogram/v4/turbo/text-to-image', 'ideogram'],
      ['krea/v2/turbo/text-to-image', 'krea'],
      ['z-image-turbo', 'z-image'],
      ['pruna-ai/p-image/edit', 'p-image'],
      ['step-image-edit-2', 'step-image'],
    ];
    for (const [id, guide] of cases) expect(guideForModel(id)?.id, id).toBe(guide);
    expect(guideIndex()).toContain('model:nano-banana — how to write prompts for Nano Banana (2, Lite, Pro) images (optional)');
    expect(readGuide('model:gpt-image')).toMatch(/params.background "transparent"/);
    expect(guideForModel('bytedance/seedance-2.5')?.optional).toBeFalsy();
  });
});

describe('a video workflow brings its video model guide', () => {
  it('knows which workflows plan clips', async () => {
    const { workflowMakesVideo } = await import('../src/engine/skills');
    expect(workflowMakesVideo('workflow:ugc')).toBe(true);
    expect(workflowMakesVideo('workflow:story')).toBe(true);
    expect(workflowMakesVideo('workflow:ugc/review')).toBe(true);
    expect(workflowMakesVideo('workflow:poster')).toBe(false);
    expect(workflowMakesVideo('skill:cinematic')).toBe(false);
    const { workflowMakesImage } = await import('../src/engine/skills');
    expect(workflowMakesImage('workflow:ugc')).toBe(true); // the creator sheet
    expect(workflowMakesImage('workflow:story')).toBe(true); // example scene sources; not mandatory outputs
  });
});
