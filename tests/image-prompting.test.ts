import { describe, expect, it } from 'vitest';
import { coerceSettings, defaultSettings, mediumQuality, promptExpansion, wireParams } from '../src/engine/params';
import { modelFit } from '../src/engine/modelRules';
import { OPS, defaultOpParams } from '../src/engine/ops';
import type { ModelSchema, ParamDef } from '../src/engine/types';

// PLAN_PROMPTING.md §2–4, with the parameters of the live snapshot (tests/fixtures/live/expected.txt).
const schema = (...params: ParamDef[]): ModelSchema => ({ ref: 'fal::x', params, slots: { prompt: 'prompt' }, source: 'openapi' });
const quality = (def: string): ParamDef => ({ key: 'quality', label: 'Quality', role: 'other', type: 'enum', options: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'], default: def });

describe('image prompting in code', () => {
  it('GPT Image quality defaults to medium where the model defaults higher (fal: high)', () => {
    const fal = schema(quality('high'));
    expect(mediumQuality(fal, 'image')).toEqual({ quality: 'medium' });
    expect(defaultSettings(fal, 'image').advanced.quality).toBe('medium');
    expect(wireParams(fal, defaultSettings(fal, 'image'), 1).quality).toBe('medium');
    // Atlas already defaults to medium: nothing to send. Video models are left alone.
    expect(mediumQuality(schema(quality('medium')), 'image')).toEqual({});
    expect(mediumQuality(fal, 'video')).toEqual({});
    // A plan step or a model change keeps it; the user's choice wins.
    expect(coerceSettings(fal, 'image', { count: 1, advanced: {} }).settings.advanced.quality).toBe('medium');
    expect(coerceSettings(fal, 'image', { count: 1, advanced: { quality: 'high' } }).settings.advanced.quality).toBe('high');
  });

  it("Ideogram's Magic Prompt is off for quoted literal text or JSON, unless the user set it", () => {
    const ideo = schema({ key: 'expand_prompt', label: 'Magic prompt', role: 'other', type: 'boolean', default: true });
    const s = defaultSettings(ideo, 'image');
    expect(promptExpansion(ideo, s, 'A jazz poster with the headline "LATE SET" at the top')).toEqual({ expand_prompt: false });
    expect(promptExpansion(ideo, s, '{"subject": "a fox"}')).toEqual({ expand_prompt: false });
    expect(promptExpansion(ideo, s, 'A fox in the snow at dusk')).toEqual({});
    expect(promptExpansion(ideo, { ...s, advanced: { expand_prompt: true } }, 'the word "HI"')).toEqual({});
  });

  it('edit-style operations say what changes, what is kept and what not to add', () => {
    const edit = OPS.edit.instruction!({ ...defaultOpParams(OPS.edit), instruction: 'make the jacket red.' });
    expect(edit).toBe('Change only this: make the jacket red. Keep everything else identical: subject and identity, composition and framing, lighting, colors and style. Do not add anything else.');
    expect(OPS.upscale.instruction!({ ...defaultOpParams(OPS.upscale), factor: '2' })).toMatch(/Only sharpen.*do not add, remove or reinterpret anything/);
    expect(OPS.angle.instruction!({ ...defaultOpParams(OPS.angle), angle: 'back' })).toMatch(/^Change only the camera viewpoint.*Do not add new objects/);
  });

  it('each image family has its line for the agent', () => {
    expect(modelFit('fal-ai/nano-banana-pro/edit')).toMatch(/photoreal hero shots/);
    expect(modelFit('nano-banana-2')).toMatch(/illustration/);
    expect(modelFit('openai/gpt-image-2.5/flare/edit')).toMatch(/text in the image.*prompt shape: scene → subject/);
    expect(modelFit('fal-ai/z-image/turbo')).toMatch(/constraints stated positively/);
  });
});
