import { describe, expect, it } from 'vitest';
import { withRealism } from '../src/engine/realism';

describe('realism', () => {
  it('is photographic by default', () => {
    const t = withRealism('A quiet scene at dusk.');
    expect(t).toContain('Photographic realism: believable natural light with slight imperfections');
    expect(t).not.toMatch(/8k|masterpiece/i);
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
  it('new generation: default photographic', () => expect(opRealism({ settings: {} }, 'image', 'a quiet scene')).toContain('Photographic realism'));
});

describe('realism policy', () => {
  it('none for ideogram and recraft', () => { expect(withRealism('a cafe scene', 'photographic', 'fal::ideogram-v3')).toBe('a cafe scene'); expect(withRealism('a cup', 'photographic', 'recraft-v3')).toBe('a cup'); });
  it('short for krea', () => { const t = withRealism('a cup', 'photographic', 'krea-1'); expect(t).toBe('a cup Natural light, real textures, plausible lens, restrained retouching.'); });
  it('never on JSON', () => expect(withRealism('{"prompt":"x"}')).toBe('{"prompt":"x"}'));
  it('not with a style reference', () => expect(withRealism('Image 1 = style reference only: do not copy its subject or content. a cup')).not.toContain('Photographic realism'));
  it('photoreal sketch render still applies', () => { expect(withRealism('photorealistic render of this sketch')).toContain('Photographic realism'); expect(withRealism('a pencil sketch of a cup')).toBe('a pencil sketch of a cup'); });
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
  it.each(cases)('%s → %s', (prompt, _id, tail) => expect(withRealism(prompt)).toBe(`${prompt} ${tail}`));
  it('explicit shot wins over the keywords', () => expect(withRealism('a woman', 'photographic', '', 'street')).toContain('35 mm at f/2'));
  it('lens already there: only the missing light', () => {
    expect(withRealism('portrait, 85mm, f/1.8')).toBe('portrait, 85mm, f/1.8 soft light from a side window, unretouched skin with visible pores.');
    expect(withRealism('portrait, 85mm, f/1.8, window light')).toBe('portrait, 85mm, f/1.8, window light');
  });
  it('short policy and style refs still hold', () => {
    expect(withRealism('a woman', 'photographic', 'krea-1')).toContain('plausible lens');
    expect(withRealism('Image 1 = style reference only: x. a woman')).not.toContain('85 mm');
  });
});

import { negFor } from '../src/engine/realism';
describe('negative prompt', () => {
  it('filled when realism applied and none set', () => expect(negFor({ count: 1 } as { negative?: string }, true).negative).toBe('cartoon, illustration, painting, 3d render, airbrushed skin, plastic skin'));
  it('kept when the user set one', () => expect(negFor({ negative: 'blur' }, true).negative).toBe('blur'));
  it('untouched when realism did not apply', () => expect(negFor({}, false).negative).toBeUndefined());
});
