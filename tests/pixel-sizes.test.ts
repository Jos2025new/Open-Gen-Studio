import { describe, expect, it } from 'vitest';
import { pixelSizes } from '../src/engine/params';

describe('pixelSizes', () => {
  const opts = ['2048x2048', '2368x1776', '1776x2368', '2816x1584', '1024x1024', '1536x1536', '1776x1328', '2048x1152'];
  it('splits exact pixel sizes into tiers and ratios and maps back', () => {
    const px = pixelSizes(opts)!;
    expect(px.tiers).toEqual(['1K', '1.5K', '2K']);
    expect(px.ratios).toEqual(expect.arrayContaining(['1:1', '4:3', '3:4', '16:9']));
    expect(px.of('2368x1776')).toEqual({ tier: '2K', ratio: '4:3' });
    expect(px.pick('1.5K', '4:3')).toBe('1776x1328');
    expect(px.pick('2K', '3:4')).toBe('1776x2368');
  });
  it('leaves ordinary aspect lists alone', () => {
    expect(pixelSizes(['1:1', '16:9'])).toBeNull();
  });
});
