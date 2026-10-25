import { describe, expect, it } from 'vitest';
import { routeVideoInputs, videoInputProblem } from '../src/engine/params';
import type { InputSlots } from '../src/engine/types';

describe('video frame input rules', () => {
  it('routes the first image as a reference when the model forbids first-frame plus refs', () => {
    const slots: InputSlots = { firstFrame: { key: 'start', format: 'url' }, images: { key: 'refs', max: 4, min: 0, multiple: true, format: 'url' }, frameRules: { refsWithFirst: false } };
    expect(routeVideoInputs(slots, ['storyboard', 'character'], [])).toEqual({ firstFrame: undefined, images: ['storyboard', 'character'], videos: [] });
  });

  const videoSlots = (frameRules: NonNullable<InputSlots['frameRules']>): InputSlots => ({ firstFrame: { key: 'start', format: 'url' }, lastFrame: { key: 'end', format: 'url' }, video: { key: 'video', format: 'url' }, images: { key: 'refs', max: 4, min: 0, multiple: true, format: 'url' }, frameRules });
  const args = (overrides: Partial<Parameters<typeof videoInputProblem>[1]> = {}) => ({ firstFrame: false, lastFrame: false, sourceVideo: false, images: 0, videos: 0, ...overrides });

  it('rejects a start frame with references when the model forbids that pair', () => {
    expect(videoInputProblem(videoSlots({ refsWithFirst: false }), args({ firstFrame: true, images: 1 }))).toBe('cannot combine reference media with a start frame.');
  });

  it('routes an image as a reference if the model forbids a start frame with references', () => {
    const slots = videoSlots({ refsWithFirst: false });
    expect(routeVideoInputs(slots, ['storyboard', 'character'], [])).toEqual({ firstFrame: undefined, images: ['storyboard', 'character'], videos: [] });
    expect(videoInputProblem(slots, args({ images: 2 }))).toBeNull();
  });

  it('rejects reference images and videos with a last frame', () => {
    const slots = videoSlots({ refsWithLast: false });
    expect(videoInputProblem(slots, args({ lastFrame: true, images: 1 }))).toMatch(/reference media.*last frame/i);
    expect(videoInputProblem(slots, args({ lastFrame: true, videos: 1 }))).toMatch(/reference media.*last frame/i);
  });

  it('rejects a source video with a last frame', () => {
    expect(videoInputProblem(videoSlots({ sourceWithLast: false }), args({ sourceVideo: true, lastFrame: true }))).toMatch(/source video.*last frame/i);
  });

  it('requires a start image for a last frame when declared', () => {
    expect(videoInputProblem(videoSlots({ lastNeedsFirst: true }), args({ lastFrame: true }))).toMatch(/start image/i);
    expect(videoInputProblem(videoSlots({ lastNeedsFirst: true }), args({ firstFrame: true, lastFrame: true }))).toBeNull();
  });

  it('checks supported resolutions with a start frame', () => {
    const slots = videoSlots({ firstFrameResolutions: ['720p'] });
    expect(videoInputProblem(slots, args({ firstFrame: true, resolution: '1080p' }))).toMatch(/1080p/);
    expect(videoInputProblem(slots, args({ firstFrame: true, resolution: '720p' }))).toBeNull();
  });

  it('applies frame exclusions before mixed-reference validation and counts mixed reference audio', () => {
    const mixed = { firstFrame: { key: 'start', format: 'url' as const }, mixedRefs: { key: 'refs', max: 9, min: 1 }, frameRules: { refsWithLast: false } };
    expect(videoInputProblem(mixed, args({ lastFrame: true, audios: 1 }))).toMatch(/reference media.*last frame/i);
  });

  it('counts refAudios after a separate single audio field, not the audio field itself', () => {
    const refs = { lastFrame: { key: 'end', format: 'url' as const }, audio: { key: 'audio', required: false, format: 'url' as const }, refAudios: { key: 'refs', max: 4, min: 0, format: 'url' as const }, frameRules: { refsWithLast: false } };
    expect(videoInputProblem(refs, args({ lastFrame: true, audios: 1 }))).toBeNull();
    expect(videoInputProblem(refs, args({ lastFrame: true, audios: 2 }))).toMatch(/reference media.*last frame/i);
  });

  it('leaves models without frame rules unchanged', () => {
    const slots: InputSlots = { firstFrame: { key: 'start', format: 'url' }, images: { key: 'refs', max: 4, min: 0, multiple: true, format: 'url' } };
    expect(videoInputProblem(slots, args({ firstFrame: true, images: 1 }))).toBeNull();
  });

});
