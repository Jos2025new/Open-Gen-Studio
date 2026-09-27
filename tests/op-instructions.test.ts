import { describe, expect, it } from 'vitest';
import { OPS, defaultOpParams } from '../src/engine/ops';

// Relight changes only the light; Reframe only extends the margins (the user saw suns, floors and skies being added).
describe('relight and reframe instructions', () => {
  it('relight changes only the lighting and forbids adding scenery or visible light sources', () => {
    const text = OPS.relight.instruction!({ ...defaultOpParams(OPS.relight), preset: 'rim', direction: 'right', intensity: 'medium' });
    expect(text).toMatch(/^Relighting edit only\. Change only the lighting: strong rim light/);
    expect(text).toContain('from the right');
    expect(text).toMatch(/no visible light sources/);
    expect(text).toMatch(/no new objects, scenery, floor, sky/);
  });

  it('reframe keeps the original untouched and adds nothing new unless the note asks', () => {
    const plain = OPS.reframe.instruction!({ ...defaultOpParams(OPS.reframe), aspect: '16:9' });
    expect(plain).toMatch(/^Outpainting only: extend the canvas to a 16:9 frame\./);
    expect(plain).toMatch(/do not redraw, restyle, relight, move, resize or crop/);
    expect(plain).toMatch(/no new objects, scenery, floor, ground, sky/);
    const withNote = OPS.reframe.instruction!({ ...defaultOpParams(OPS.reframe), aspect: '16:9', note: 'a wooden floor' });
    expect(withNote).toContain('In the new area, add only this: a wooden floor.');
    expect(withNote).not.toMatch(/no new objects/);
  });
});
