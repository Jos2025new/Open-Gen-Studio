import { describe, expect, it } from 'vitest';
import { routeVideoInputs, videoInputProblem } from '../src/engine/params';
import type { InputSlots } from '../src/engine/types';

describe('video frame input rules', () => {
  it('routes the first image as a reference when the model forbids first-frame plus refs', () => {
    const slots: InputSlots = { firstFrame: { key: 'start', format: 'url' }, images: { key: 'refs', max: 4, min: 0, multiple: true, format: 'url' }, frameRules: { refsWithFirst: false } };
    expect(routeVideoInputs(slots, ['storyboard', 'character'], [])).toEqual({ firstFrame: undefined, images: ['storyboard', 'character'], videos: [] });
  });

});
