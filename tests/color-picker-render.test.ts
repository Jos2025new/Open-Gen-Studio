import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ColorChannels } from '../src/components/designer/ColorChannels';
import { hexShown } from '../src/lib/color';

const render = (alpha?: number) => renderToStaticMarkup(createElement(ColorChannels, {
  value: '#34ee25', hue: 110, onHueChange: () => undefined, onChange: () => undefined,
  alpha, onAlphaChange: alpha === undefined ? undefined : () => undefined,
}));

describe('color picker row', () => {
  it('labels the fields and gives the alpha slider and field', () => {
    const html = render(37);
    // Visible labels of the fields (H S L in HSL mode, the A field after them).
    for (const short of ['H', 'S', 'L', 'A']) expect(html).toMatch(new RegExp(`<span class="muted"[^>]*>${short}</span>`));
    expect(html).toContain('aria-label="Alpha"');
    expect(html).toContain('aria-label="A"');
  });
  it('the four number fields sit in one row container', () => {
    const html = render(37);
    const row = /<div class="color-fields"[^>]*>(.*?)<\/div>/.exec(html)?.[1] ?? '';
    expect((row.match(/class="color-num"/g) ?? []).length).toBe(4);
    expect(row).toContain('display:flex');
  });
  it('the hex shows 8 digits below 100 % and 6 at 100 %', () => {
    expect(hexShown('#34ee25', 0.37)).toBe('#34ee255e');
    expect(hexShown('#34ee25', 1)).toBe('#34ee25');
    expect(hexShown('#34ee25', undefined)).toBe('#34ee25');
  });
});

describe('mode buttons say what they show', () => {
  it('HSLA and RGBA, since both carry the alpha channel', () => {
    const html = render(37);
    expect(html).toContain('>HSLA<');
    expect(html).toContain('>RGBA<');
    expect(html).not.toMatch(/>HSL</);
  });
});
