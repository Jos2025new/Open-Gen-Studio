import { describe, expect, it } from 'vitest';
import { colorHsl, colorRgb, hslHex, rgbHex } from '../src/lib/color';

describe('picker color channels', () => {
  it('preserves exact colors when switching between RGB and HSL', () => {
    for (const color of ['#ffffff', '#000000', '#808080', '#ff0000', '#00ff00', '#0000ff', '#d4f25a', '#123456']) {
      expect(rgbHex(colorRgb(color))).toBe(color);
      expect(hslHex(colorHsl(color))).toBe(color);
    }
  });
  it('produces the channel endpoints shown by the gradients', () => {
    expect(hslHex([120, 100, 50])).toBe('#00ff00');
    expect(hslHex([120, 0, 50])).toBe('#808080');
    expect(hslHex([120, 100, 0])).toBe('#000000');
    expect(hslHex([120, 100, 100])).toBe('#ffffff');
    expect(rgbHex([300, -10, 127.5])).toBe('#ff0080');
  });
});
