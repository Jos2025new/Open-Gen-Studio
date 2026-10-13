import { describe, expect, it } from 'vitest';
import { alphaFromOpacity, opacityFromAlpha, parseAlphaText, parseHexAlpha } from '../src/lib/color';

describe('A and the tool opacity are one value', () => {
  it('A to opacity and back, both ways', () => {
    expect(opacityFromAlpha(50)).toBe(0.5);
    expect(alphaFromOpacity(0.5)).toBe(50);
    expect(alphaFromOpacity(opacityFromAlpha(37))).toBe(37);
    expect(opacityFromAlpha(150)).toBe(1);
    expect(opacityFromAlpha(-5)).toBe(0);
  });
  it('an opacity set by the slider shows as A', () => {
    expect(alphaFromOpacity(0.25)).toBe(25);
    expect(alphaFromOpacity(1)).toBe(100);
  });
  it('a typed #RRGGBBAA gives the color and the alpha; #RRGGBB keeps 100 %', () => {
    expect(parseHexAlpha('#FF000080')).toEqual({ color: '#ff0000', alpha: 50 });
    expect(parseHexAlpha('#ff0000ff')).toEqual({ color: '#ff0000', alpha: 100 });
    expect(parseHexAlpha('#00ff00')).toEqual({ color: '#00ff00', alpha: 100 });
    expect(parseHexAlpha('#00ff0')).toBeNull();
  });
  it('the A field takes whole numbers 0 to 100 only', () => {
    expect(parseAlphaText('0')).toBe(0);
    expect(parseAlphaText('100')).toBe(100);
    for (const bad of ['101', '-1', '50.5', '', 'a']) expect(parseAlphaText(bad)).toBeNull();
  });
});
