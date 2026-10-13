import { describe, expect, it } from 'vitest';
import { parseHexInput, setRgbChannel } from '../src/lib/color';

describe('typed color values', () => {
  it('accepts #RRGGBB with or without the # and in any case', () => {
    expect(parseHexInput('#FF8000')).toBe('#ff8000');
    expect(parseHexInput(' 00ff7a ')).toBe('#00ff7a');
  });
  it('refuses anything else, including 8-digit colors the brush cannot paint', () => {
    for (const bad of ['#fff', '#ff800', '#ff8000ff', 'red', '#gg0000', '']) expect(parseHexInput(bad)).toBeNull();
  });
  it('sets one channel only for a whole number from 0 to 255', () => {
    expect(setRgbChannel('#102030', 1, '255')).toBe('#10ff30');
    expect(setRgbChannel('#102030', 0, '0')).toBe('#002030');
    for (const bad of ['256', '-1', '1.5', '', 'x', '1000']) expect(setRgbChannel('#102030', 2, bad)).toBeNull();
  });
});
