import { describe, expect, it } from 'vitest';
import { withRealism } from '../src/engine/realism';

describe('realism', () => {
  it('is photographic by default', () => {
    const t = withRealism('A woman reading by a window.');
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
    expect(withRealism('x', 'ugc')).toContain('Candid phone-camera realism');
    expect(withRealism('x', 'studio')).toContain('Studio photographic realism');
  });
});

import { opRealism } from '../src/engine/realism';
describe('opRealism', () => {
  const op = { id: 'edit' };
  it('edit without explicit realism: no clause', () => expect(opRealism({ op, settings: {} }, 'image', 'make the coat red')).toBe('make the coat red'));
  it('edit with explicit ugc: clause', () => expect(opRealism({ op, settings: { realism: 'ugc' } }, 'image', 'x')).toContain('Candid phone-camera realism'));
  it('new generation: default photographic', () => expect(opRealism({ settings: {} }, 'image', 'a cup')).toContain('Photographic realism'));
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
