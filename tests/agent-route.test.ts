import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { mediumResolution, promptCitation, promptLimit } from '../src/engine/params';
import { REFERENCE_PROTOCOLS, modelFit } from '../src/engine/modelRules';
import { normalizePlan, type PlanContext } from '../src/engine/plan';
import { SYSTEM_PROMPT } from '../src/engine/agent/context';

describe('medium quality by default (R1)', () => {
  it('takes the middle size, never the highest', () => {
    expect(mediumResolution(['480p', '720p', '1080p'], '1080p')).toBe('720p');
    expect(mediumResolution(['720p', '1080p'], '1080p')).toBe('720p');
    expect(mediumResolution(['1080p', '720p', '4k', '480p'])).toBe('720p');
  });

  it("keeps the model's default when it is already smaller, and leaves non-size options alone", () => {
    expect(mediumResolution(['480p', '720p', '1080p'], '480p')).toBe('480p');
    expect(mediumResolution(['standard', 'pro'], 'pro')).toBe('pro');
    expect(mediumResolution(['1080p'], '1080p')).toBe('1080p');
  });
});

describe('default route and prompting rules in the system prompt (R1, R2)', () => {
  it('states the default route, the purpose tables and the prompting rules', () => {
    for (const s of ['Default route', 'set purpose on each video step', 'cheapest model that fits', 'keep the user selection', 'use the image default supplied by the app', 'never from how many references', 'do not describe the image again', 'Never paraphrase a reference']) {
      expect(SYSTEM_PROMPT).toContain(s);
    }
    expect(SYSTEM_PROMPT).not.toMatch(/Usually 40-120 words\. Write prompts/);
  });
});

describe('reference protocols, model fit and prompt limits (R3)', () => {
  it('reads the prompt limit from maxLength or the description, never from a recommendation', () => {
    expect(promptLimit({ maxLength: 2500 })).toBe(2500);
    expect(promptLimit({ description: 'Text prompt for generation. Maximum 20,000 characters.' })).toBe(20000);
    expect(promptLimit({ description: 'The text prompt (up to 20000 characters).' })).toBe(20000);
    expect(promptLimit({ description: 'Text instruction for editing. Max 800 characters.' })).toBe(800);
    expect(promptLimit({ description: 'Maximum 2,500 characters.', maxLength: 2000 })).toBe(2000);
    expect(promptLimit({ description: 'Recommended length: Chinese < 500 characters, English < 1000 words.' })).toBeUndefined();
  });

  it("keeps the provider's own citation syntax from the prompt description", () => {
    expect(promptCitation('Text prompt describing the desired video. Cite reference inputs in submission order with @-syntax: @Image1, @Video1, @Audio1, etc. Prompts p')).toMatch(/^Cite reference inputs .*@Image1/);
    expect(promptCitation('Editing instruction. When supplying multiple source images, cite them as <IMAGE_0>, <IMAGE_1>, <IMAGE_2>.')).toMatch(/<IMAGE_0>/);
    expect(promptCitation('The text prompt describing the video you want to generate')).toBeUndefined();
  });

  it('the validator rejects a prompt over the limit before anything is sent', async () => {
    const model = { ref: 'fal::m', provider: 'fal', id: 'm', name: 'M', kind: 'video', acceptsText: true, tags: [] } as never;
    const ctx: PlanContext = {
      workspace: 'chat',
      getModel: async () => ({ model, schema: { ref: 'fal::m', params: [], slots: { prompt: 'prompt', promptMax: 20 }, source: 'openapi' } }),
      defaultModel: () => 'fal::m',
      defaultSettings: () => ({}),
      asset: () => undefined,
      layer: () => undefined,
    };
    const { errors } = await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'video', prompt: 'x'.repeat(21) }] }, ctx, 'p');
    expect(errors.join(' ')).toMatch(/up to 20 characters \(this one has 21\).*\[PROMPT_TOO_LONG\]/);
  });

  it('in Nodes, one step may feed two of its candidates: each link keeps its result (A24, audit E5-01)', async () => {
    const model = { ref: 'fal::img', provider: 'fal', id: 'img', name: 'Img', kind: 'image', acceptsText: true, tags: [] } as never;
    const ctx: PlanContext = {
      workspace: 'node',
      getModel: async () => ({ model, schema: { ref: 'fal::img', params: [], slots: { prompt: 'prompt', images: { param: 'images', max: 4 } }, source: 'openapi' } as never }),
      defaultModel: () => 'fal::img',
      defaultSettings: () => ({}),
      asset: () => undefined,
      layer: () => undefined,
    };
    const plan = (a: string, b: string) => ({ title: 't', steps: [
      { id: 's1', kind: 'image', prompt: 'a face', count: 2 },
      { id: 's2', kind: 'image', prompt: 'the face, smiling', refs: [a] },
      { id: 's3', kind: 'image', prompt: 'the face, serious', refs: [b] },
    ] });
    const split = await normalizePlan(plan('s1#1', 's1#2') as never, ctx, 'p');
    expect(split.errors).toEqual([]);
    const same = await normalizePlan(plan('s1#2', 's1#2') as never, ctx, 'p');
    expect(same.errors.join(' ')).not.toMatch(/different results/);
    // A step that names a subject made by s1 waits for s1 ("after"): that orders the run and picks no result.
    const wait = { title: 't', subjects: [{ name: 'Kai', kind: 'character', from: 's1#2' }], steps: [
      { id: 's1', kind: 'image', prompt: 'a face', count: 2 },
      { id: 's2', kind: 'image', prompt: '@Kai smiling', refs: ['s1#2'] },
    ] };
    expect((await normalizePlan(wait as never, ctx, 'p')).errors.join(' ')).not.toMatch(/different results/);
  });

  it('counts the plan style, which is appended to the prompt after validation (audit E3-02)', async () => {
    const model = { ref: 'fal::m', provider: 'fal', id: 'm', name: 'M', kind: 'video', acceptsText: true, tags: [] } as never;
    const ctx: PlanContext = {
      workspace: 'chat',
      getModel: async () => ({ model, schema: { ref: 'fal::m', params: [], slots: { prompt: 'prompt', promptMax: 30 }, source: 'openapi' } }),
      defaultModel: () => 'fal::m',
      defaultSettings: () => ({}),
      asset: () => undefined,
      layer: () => undefined,
    };
    const fits = await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'video', prompt: 'x'.repeat(20) }] }, ctx, 'p');
    expect(fits.errors.join(' ')).not.toMatch(/PROMPT_TOO_LONG/);
    const { errors } = await normalizePlan({ title: 't', style: 'warm film', steps: [{ id: 's1', kind: 'video', prompt: 'x'.repeat(20) }] }, ctx, 'p');
    expect(errors.join(' ')).toMatch(/this one has 38, with the plan style\).*\[PROMPT_TOO_LONG\]/);
  });

  it('each model of the purpose table gets its fit line, other models none', () => {
    expect(modelFit('minimax/h3-max-turbo/text-to-video')).toMatch(/drafts/);
    expect(modelFit('minimax/h3-developer/image-to-video')).toMatch(/normal clips \(cheapest/);
    expect(modelFit('bytedance-seedance-2-0-fast')).toMatch(/best quality for the price/);
    expect(modelFit('bytedance/seedance-2.5/reference-to-video')).toMatch(/only when the user asks.*avoid for default use/);
    expect(modelFit('alibaba/wan-3.0/image-to-video')).toMatch(/long takes over 15 s/);
    expect(modelFit('kwaivgi/kling-v3.0-pro/text-to-video')).toBeUndefined();
    expect(modelFit('minimax/h3/text-to-video')).toBeUndefined();
    expect(modelFit('bytedance/seedance-2.0-mini/text-to-video')).toBeUndefined();
  });

  it('the system prompt carries each family protocol once, with MiniMax as <Picture N>', () => {
    for (const p of REFERENCE_PROTOCOLS) expect(SYSTEM_PROMPT.split(p.note).length).toBe(2);
    expect(SYSTEM_PROMPT).toContain('<Picture 1>');
    expect(SYSTEM_PROMPT).toContain('use exactly that');
  });
});

describe('aspect from the input image (R7)', () => {
  const model = { ref: 'fal::v', provider: 'fal', id: 'v', name: 'V', kind: 'video', acceptsText: true, acceptsImage: true, tags: [] } as never;
  const schema = { ref: 'fal::v', params: [{ key: 'aspect_ratio', role: 'aspect', type: 'enum', options: ['16:9', '9:16', '1:1'], default: '16:9' }], slots: { prompt: 'prompt', firstFrame: { key: 'image_url', format: 'url' } }, source: 'openapi' } as never;
  const ctx: PlanContext = {
    workspace: 'chat',
    getModel: async (r) => (r === 'fal::v' ? { model, schema } : null),
    defaultModel: () => 'fal::v',
    defaultSettings: () => ({ aspect: '16:9' }),
    asset: (id) => (id === 'tall' ? { kind: 'image', width: 720, height: 1280 } : undefined),
    layer: () => undefined,
  };
  const aspect = (plan: Awaited<ReturnType<typeof normalizePlan>>['plan']) => (plan!.steps[0] as { settings: { aspect?: string } }).settings.aspect;

  it('a portrait start image gives a portrait clip, noted as an adjustment', async () => {
    const r = await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'video', prompt: 'walk', first_frame: 'asset:tall' }] }, ctx, 'p');
    expect(aspect(r.plan)).toBe('9:16');
    expect(r.plan!.adjustments.join(' ')).toMatch(/aspect 9:16 from the input image/);
  });

  it('an aspect set by the step wins; without an image the default stays', async () => {
    const a = await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'video', prompt: 'walk', first_frame: 'asset:tall', aspect: '1:1' }] }, ctx, 'p');
    expect(aspect(a.plan)).toBe('1:1');
    const b = await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'video', prompt: 'a city' }] }, ctx, 'p');
    expect(aspect(b.plan)).toBe('16:9');
  });
});

describe('recommended skill per workflow (R5)', () => {
  it('every workflow names an existing skill; the user pick wins', async () => {
    const { WORKFLOWS, activeSkill, skillById } = await import('../src/engine/skills');
    for (const w of WORKFLOWS) expect(skillById(w.skill), w.id).toBeDefined();
    expect(activeSkill(null, 'character-sheet')?.id).toBe('character');
    expect(activeSkill('poster', 'character-sheet')?.id).toBe('poster');
    expect(activeSkill(null, null)).toBeUndefined();
  });
});

describe('subject mentions in each model syntax (R10)', () => {
  it('the schema syntax wins, then the family; zero-based syntaxes count from 0', async () => {
    const { refMentionStyle, mentionSubjects } = await import('../src/engine/params');
    expect(refMentionStyle('xai/grok-imagine-image/edit', 'For multi-image references, cite each input as <IMAGE_0>, <IMAGE_1>, ...')).toEqual({ template: '<IMAGE_{n}>', zeroBased: true });
    expect(refMentionStyle('alibaba/wan-3.0/reference-to-video', "'the subject in Image 1 walks past Video 1'.")?.template).toBe('Image {n}');
    expect(refMentionStyle('alibaba/wan-3.0/reference-to-video')?.template).toBe('Image {n}');
    expect(refMentionStyle('minimax-h3/reference-to-video')?.template).toBe('<Picture {n}>');
    expect(refMentionStyle('some/other-model')).toBeUndefined();
    const subjects = [{ id: 'a', name: 'Ana' }];
    // One image already in the step: Ana is the second image, <IMAGE_1> when counting from 0.
    expect(mentionSubjects('@Ana smiles', subjects, '<IMAGE_{n}>', 1 - 1).prompt).toBe('<IMAGE_1> smiles');
    expect(mentionSubjects('@Ana smiles', subjects, '@Image{n}', 1).prompt).toBe('@Image2 smiles');
  });
});

describe('skills and workflows index, guides and total length (R4)', () => {
  it('indexes every workflow and skill once; read_guide returns the full text with brief fields, continuity and skill', async () => {
    const { SKILLS, WORKFLOWS, guideIndex, readGuide } = await import('../src/engine/skills');
    const index = guideIndex();
    for (const w of WORKFLOWS) expect(index.split(`workflow:${w.id} —`).length).toBe(2);
    for (const k of SKILLS) expect(index.split(`skill:${k.id} —`).length).toBe(2);
    expect(SYSTEM_PROMPT).toContain(index);
    const sheet = readGuide('workflow:character-sheet')!;
    expect(sheet).toMatch(/brief fields .*the character/);
    expect(sheet).toMatch(/continuity: Every requested independent view derives from the original provided image/);
    expect(sheet).toMatch(/skill Character consistency:/);
    expect(readGuide('skill:product')).toMatch(/^Product photography:/);
    expect(readGuide('workflow:nope')).toBeUndefined();
    expect(readGuide('workflow:storyboard/nope')).toBeUndefined();
  });

  it('no workflow fixes the resolution (it follows the chosen quality)', async () => {
    const { WORKFLOWS } = await import('../src/engine/skills');
    for (const w of WORKFLOWS) expect(Object.keys(w.fixed ?? {})).not.toContain('resolution');
  });

  it('total_duration is split over the video steps that set no duration, and noted', async () => {
    const model = { ref: 'fal::v', provider: 'fal', id: 'v', name: 'V', kind: 'video', acceptsText: true, tags: [] } as never;
    const schema = { ref: 'fal::v', params: [{ key: 'duration', role: 'duration', type: 'enum', options: [5, 10], default: 5 }], slots: { prompt: 'prompt' }, source: 'openapi' } as never;
    const ctx: PlanContext = {
      workspace: 'chat',
      getModel: async () => ({ model, schema }),
      defaultModel: () => 'fal::v',
      defaultSettings: () => ({ duration: 5 }),
      asset: () => undefined,
      layer: () => undefined,
    };
    const r = await normalizePlan({ title: 't', total_duration: 30, steps: [1, 2, 3].map((i) => ({ id: `s${i}`, kind: 'video', prompt: `shot ${i}` })) }, ctx, 'p');
    expect(r.plan!.steps.map((x) => (x as { settings: { duration?: number } }).settings.duration)).toEqual([10, 10, 10]);
    expect(r.plan!.adjustments.join(' ')).toMatch(/total 30s: s1 10s, s2 10s, s3 10s/);
  });

  const totalCtx = (options: number[]): PlanContext => {
    const model = { ref: 'fal::v', provider: 'fal', id: 'v', name: 'V', kind: 'video', acceptsText: true, tags: [] } as never;
    const schema = { ref: 'fal::v', params: [{ key: 'duration', role: 'duration', type: 'enum', options, default: options[0] }], slots: { prompt: 'prompt' }, source: 'openapi' } as never;
    return { workspace: 'chat', getModel: async () => ({ model, schema }), defaultModel: () => 'fal::v', defaultSettings: () => ({ duration: options[0] }), asset: () => undefined, layer: () => undefined };
  };
  const durs = (r: { plan: { steps: unknown[] } | null }) => r.plan!.steps.map((x) => (x as { settings: { duration?: number } }).settings.duration);
  const clips = (n: number, extra: Record<string, unknown> = {}) => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, kind: 'video', prompt: `shot ${i + 1}`, ...(i === 0 ? extra : {}) }));

  it('25 s over three clips of 5/10 s is 10+10+5, with no note (E3-01)', async () => {
    const r = await normalizePlan({ title: 't', total_duration: 25, steps: clips(3) }, totalCtx([5, 10]), 'p');
    expect(r.errors).toEqual([]);
    expect(durs(r)).toEqual([10, 10, 5]);
    expect(r.plan!.adjustments.join(' ')).not.toMatch(/video total/);
    // The share note says the lengths chosen, not the even «about 8s».
    expect(r.plan!.adjustments).toContain('total 25s: s1 10s, s2 10s, s3 5s');
    expect(r.plan!.adjustments.join(' ')).not.toMatch(/about 8s/);
    const even = await normalizePlan({ title: 't', total_duration: 30, steps: clips(3) }, totalCtx([5, 10]), 'p');
    expect(durs(even)).toEqual([10, 10, 10]);
    expect(even.plan!.adjustments.join(' ')).not.toMatch(/video total/);
  });

  it('a total no combination makes keeps the closest sum and the note (B12, E3-01)', async () => {
    const r = await normalizePlan({ title: 't', total_duration: 22, steps: clips(3) }, totalCtx([5, 10]), 'p');
    expect(r.errors).toEqual([]);
    expect(durs(r)!.reduce((a, b) => a! + b!, 0)).toBe(20);
    expect(r.plan!.adjustments).toContain('video total: 20 s instead of the 22 s asked; each clip uses a length the model allows.');
  });

  it('a clip with its own duration keeps it; only the unset ones are chosen (E3-01)', async () => {
    const r = await normalizePlan({ title: 't', total_duration: 25, steps: clips(3, { duration: 5 }) }, totalCtx([5, 10]), 'p');
    expect(durs(r)).toEqual([5, 10, 10]);
    expect(r.plan!.adjustments.join(' ')).not.toMatch(/video total/);
  });
});
