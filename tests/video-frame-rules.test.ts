import { describe, expect, it } from 'vitest';
import { routeVideoInputs, videoInputProblem } from '../src/engine/params';
import type { InputSlots } from '../src/engine/types';

describe('video frame input rules', () => {
  it('routes the first image as a reference when the model forbids first-frame plus refs', () => {
    const slots: InputSlots = { firstFrame: { key: 'start', format: 'url' }, images: { key: 'refs', max: 4, min: 0, multiple: true, format: 'url' }, frameRules: { refsWithFirst: false } };
    expect(routeVideoInputs(slots, ['storyboard', 'character'], [])).toEqual({ firstFrame: undefined, images: ['storyboard', 'character'], videos: [] });
  });

  it('checks last-frame combinations and resolutions only when rules are declared', () => {
    const slots: InputSlots = { firstFrame: { key: 'start', format: 'url' }, lastFrame: { key: 'end', format: 'url' }, video: { key: 'video', format: 'url' }, images: { key: 'refs', max: 4, min: 0, multiple: true, format: 'url' }, frameRules: { refsWithLast: false, sourceWithLast: false, lastNeedsFirst: true, firstFrameResolutions: ['720p'] } };
    const check = (overrides: Partial<Parameters<typeof videoInputProblem>[1]>) => videoInputProblem(slots, { firstFrame: false, lastFrame: false, sourceVideo: false, images: 0, videos: 0, ...overrides });
    expect(check({ firstFrame: true, lastFrame: true, images: 1 })).toMatch(/reference images.*last frame/i);
    expect(check({ lastFrame: true })).toMatch(/start image/i);
    expect(check({ firstFrame: true, lastFrame: true, sourceVideo: true })).toMatch(/source video.*last frame/i);
    expect(check({ firstFrame: true, resolution: '1080p' })).toMatch(/1080p/);
    expect(check({ firstFrame: true, resolution: '720p' })).toBeNull();
    expect(videoInputProblem({ firstFrame: slots.firstFrame }, { firstFrame: true, lastFrame: false, sourceVideo: false, images: 0, videos: 0 })).toBeNull();
  });

});
