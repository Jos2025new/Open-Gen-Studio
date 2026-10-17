import { describe, expect, it } from 'vitest';
import { withRealism } from '../src/engine/realism';

describe('realism', () => {
  it('is balanced by default: moderate depth of field, soft light, restrained retouching', () => {
    const t = withRealism('A quiet scene at dusk.');
    expect(t).toBe('A quiet scene at dusk. 35 mm at f/4, moderate depth of field, natural perspective, available or motivated soft light, natural skin and material texture with small real-world flaws, restrained retouching, no oversharpening.');
    expect(t).not.toMatch(/8k|masterpiece|bokeh|85 mm/i);
  });
  it('cinematic keeps the polished clause (photographic is its old name)', () => {
    expect(withRealism('A quiet scene at dusk.', 'cinematic')).toContain('Photographic realism: believable natural light with slight imperfections');
    expect(withRealism('A quiet scene at dusk.', 'photographic')).toBe(withRealism('A quiet scene at dusk.', 'cinematic'));
  });
  it('none leaves the prompt untouched', () => {
    expect(withRealism('A woman reading.', 'none')).toBe('A woman reading.');
  });
  it('another medium is left alone', () => {
    expect(withRealism('An anime girl in a garden')).toBe('An anime girl in a garden');
  });
  it('ugc and studio differ', () => {
    expect(withRealism('x', 'ugc')).toBe('x Main phone camera, slightly tilted casual framing, ambient light or direct flash, natural skin, mild sensor noise.');
    expect(withRealism('x', 'studio')).toContain('85 mm at f/8, seamless backdrop');
  });
});

import { opRealism } from '../src/engine/realism';
describe('opRealism', () => {
  const op = { id: 'edit' };
  it('edit without explicit realism: no clause', () => expect(opRealism({ op, settings: {} }, 'image', 'make the coat red')).toBe('make the coat red'));
  it('edit with explicit ugc: clause', () => expect(opRealism({ op, settings: { realism: 'ugc' } }, 'image', 'x')).toContain('Main phone camera'));
  it('new generation: default photographic', () => expect(opRealism({ settings: {} }, 'image', 'a quiet scene')).toContain('moderate depth of field'));
});

describe('realism policy', () => {
  it('none for ideogram and recraft', () => { expect(withRealism('a cafe scene', 'photographic', 'fal::ideogram-v3')).toBe('a cafe scene'); expect(withRealism('a cup', 'photographic', 'recraft-v3')).toBe('a cup'); });
  it('short for krea', () => { const t = withRealism('a cup', 'photographic', 'krea-1'); expect(t).toBe('a cup Natural light, real textures, plausible lens, restrained retouching.'); });
  it('never on JSON', () => expect(withRealism('{"prompt":"x"}')).toBe('{"prompt":"x"}'));
  it('not with a style reference', () => expect(withRealism('Image 1 = style reference only: do not copy its subject or content. a cup')).not.toContain('moderate depth'));
  it('photoreal sketch render still applies', () => { expect(withRealism('photorealistic render of this sketch')).toContain('moderate depth of field'); expect(withRealism('a pencil sketch of a cup')).toBe('a pencil sketch of a cup'); });
  it('poster is not photographic', () => expect(withRealism('a poster for a gig')).toBe('a poster for a gig'));
  it('no duplicate when photographic vocabulary exists', () => expect(withRealism('portrait, 85mm, f/1.8, golden hour')).toBe('portrait, 85mm, f/1.8, golden hour'));
});

describe('shot sheets', () => {
  const cases: Array<[string, string, string]> = [
    ['portrait of a woman', 'portrait', '85 mm at f/1.8, shallow depth of field, soft light from a side window, unretouched skin with visible pores.'],
    ['a market street at noon', 'street', '35 mm at f/2, candid framing, available light, Portra 400 film look with natural grain.'],
    ['a perfume bottle on marble', 'product', '100 mm macro at f/8, soft overhead softbox, true materials with fine surface texture and a subtle contact shadow.'],
    ['a mountain valley', 'landscape', '24 mm at f/8, natural light at the hour of the scene, atmospheric haze, fine foliage and rock detail.'],
    ['a bright kitchen interior', 'interior', '24 mm at f/8, straight verticals, window daylight balanced with warm lamps, real material textures.'],
    ['a burger on a plate', 'food', '50 mm macro at f/4, soft side window light, natural steam, crumbs and glossy highlights.'],
    ['a dog jumping', 'pet', '70-200 mm at f/2.8, fast shutter, eye in sharp focus, natural daylight, fine fur detail.'],
  ];
  it.each(cases)('%s → %s', (prompt, _id, tail) => expect(withRealism(prompt, 'cinematic')).toBe(`${prompt} ${tail}`));
  it('explicit shot wins over the keywords', () => expect(withRealism('a woman', 'cinematic', '', 'street')).toContain('35 mm at f/2'));
  it('lens already there: only the missing light', () => {
    expect(withRealism('portrait, 85mm, f/1.8', 'cinematic')).toBe('portrait, 85mm, f/1.8 soft light from a side window, unretouched skin with visible pores.');
    expect(withRealism('portrait, 85mm, f/1.8, window light')).toBe('portrait, 85mm, f/1.8, window light');
  });
  it('short policy and style refs still hold', () => {
    expect(withRealism('a woman', 'balanced', 'krea-1')).toContain('plausible lens');
    expect(withRealism('Image 1 = style reference only: x. a woman')).not.toContain('85 mm');
  });
});

import { negFor } from '../src/engine/realism';
describe('negative prompt', () => {
  it('filled when realism applied and none set', () => expect(negFor({ count: 1 } as { negative?: string }, true).negative).toBe('cartoon, illustration, painting, 3d render, airbrushed skin, plastic skin'));
  it('kept when the user set one', () => expect(negFor({ negative: 'blur' }, true).negative).toBe('blur'));
  it('untouched when realism did not apply', () => expect(negFor({} as { negative?: string }, false).negative).toBeUndefined());
});

describe('registers for image and video', () => {
  const clip = { kind: 'video' as const };
  it('everyday image uses the phone sheet; ugc string unchanged', () => {
    expect(withRealism('a kitchen table', 'everyday')).toContain('Phone camera, wide lens, deep focus');
    expect(withRealism('x', 'ugc')).toBe('x Main phone camera, slightly tilted casual framing, ambient light or direct flash, natural skin, mild sensor noise.');
  });
  it('scene sheets only in cinematic; balanced ignores the shot', () => {
    expect(withRealism('a woman', 'balanced', '', 'portrait')).toContain('35 mm at f/4');
    expect(withRealism('a woman', 'cinematic', '', 'portrait')).toContain('85 mm at f/1.8');
  });
  it('video gets the register: balanced default, everyday, cinematic', () => {
    expect(withRealism('a man walks', undefined, '', undefined, clip)).toContain('locked-off or light handheld, slow motivated camera, no gimbal-perfect glides');
    const e = withRealism('a man walks', 'everyday', '', undefined, clip);
    expect(e).toContain('subtle handheld micro-shake');
    expect(e).toContain('30 fps phone cadence');
    expect(e).toContain('phone-mic');
    const c = withRealism('a man walks', 'cinematic', '', undefined, clip);
    expect(c).toContain('180-degree shutter motion blur');
    expect(c).toContain('24 fps');
  });
  it('video from a start image adds only motion, cadence and audio', () => {
    const t = withRealism('he turns', 'everyday', '', undefined, { kind: 'video', anchored: true });
    expect(t).toBe('he turns small reframing drift, imperfect timing, no smooth glides, 30 fps phone cadence, room tone and phone-mic sound.');
  });
  it('identity references keep noise mild', () => {
    expect(withRealism('a man walks', 'everyday', '', undefined, { kind: 'video', refs: true })).toContain('identity and details unchanged');
    expect(withRealism('a man', 'everyday', '', undefined, { refs: true })).toContain('identity and details unchanged');
  });
  it('video guards: JSON, other media, camera words, edits', () => {
    expect(withRealism('{"prompt":"x"}', 'everyday', '', undefined, clip)).toBe('{"prompt":"x"}');
    expect(withRealism('an anime girl runs', 'everyday', '', undefined, clip)).toBe('an anime girl runs');
    expect(withRealism('handheld shot of a man walking', 'cinematic', '', undefined, clip)).toBe('handheld shot of a man walking');
    expect(opRealism({ op: { id: 'continue' }, settings: {} }, 'video', 'x')).toBe('x');
  });
  it('opRealism applies to video and reads the first frame', () => {
    expect(opRealism({ settings: { realism: 'everyday' } }, 'video', 'x')).toContain('Phone camera');
    expect(opRealism({ settings: { realism: 'everyday' }, inputs: { firstFrame: 'a' } }, 'video', 'x')).not.toContain('Phone camera');
    expect(opRealism({ settings: {} }, 'audio', 'x')).toBe('x');
  });
});

import { withRealismSetting } from '../src/engine/realism';
describe('plan settings', () => {
  it('video steps keep realism; other kinds do not', () => {
    expect(withRealismSetting({ a: 1 }, 'video', 'everyday')).toEqual({ a: 1, realism: 'everyday' });
    expect(withRealismSetting({ a: 1 }, 'audio', 'everyday')).toEqual({ a: 1 });
  });
});
