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
