import { describe, expect, it, vi } from 'vitest';

// Ten px per character, so the bars' geometry is exact without a real canvas.
vi.mock('../src/lib/media', () => ({ createCanvas: () => ({}), ctx2d: () => ({ font: '', letterSpacing: '', measureText: (s: string) => ({ width: s.length * 10 }) }) }));
import type { TextLayer } from '../src/engine/types';
import { applyTextCase, decorationRects } from '../src/engine/design/textLayout';
import { textSvg } from '../src/engine/design/export';

const text = (o: Partial<TextLayer> = {}): TextLayer => ({ id: 't', name: 'T', type: 'text', visible: true, locked: false, opacity: 1, blend: 'normal', x: 10, y: 20, width: 200, text: 'Hello world', fontFamily: 'Inter', fontSize: 32, fontWeight: 400, color: '#112233', align: 'left', lineHeight: 1.5, letterSpacing: 0, ...o });
const t = { lines: ['Hello world'], width: 200, lineHeightPx: 48 };

describe('text case', () => {
  it('changes the shown text only when asked', () => {
    expect(applyTextCase('hello wORLD')).toBe('hello wORLD');
    expect(applyTextCase('hello wORLD', 'upper')).toBe('HELLO WORLD');
    expect(applyTextCase('Hello WORLD', 'lower')).toBe('hello world');
    expect(applyTextCase("hello don't\nécole", 'title')).toBe("Hello Don't\nÉcole");
  });
});

describe('text decoration', () => {
  it('old text has no bars and its SVG is unchanged', () => {
    expect(decorationRects(text(), t, 25)).toEqual([]);
    expect(textSvg(text(), t, 25).startsWith('<text ')).toBe(true);
  });

  it('draws one bar per line and kind, below the baseline for underline and above it for strikethrough', () => {
    const bars = decorationRects(text({ underline: true, strike: true }), { ...t, lines: ['ab', '', 'cd'] }, 25);
    expect(bars).toHaveLength(4); // the empty line has none
    const base = 20 + (48 - 32) / 2 + 25;
    expect(bars[0].y).toBeGreaterThan(base);
    expect(bars[1].y).toBeLessThan(base);
    expect(bars[0].h).toBe(2);
  });

  it('exports the same bars in the text color', () => {
    const svg = textSvg(text({ underline: true }), t, 25);
    expect(svg.startsWith('<g><text ')).toBe(true);
    expect(svg).toMatch(/<rect [^>]*fill="#112233"\/><\/g>$/);
  });
});

it('Title case capitalizes after hyphens and brackets, as the editor (CSS capitalize) shows it', async () => {
  const { applyTextCase } = await import('../src/engine/design/textLayout');
  expect(applyTextCase('well-known (x) don’t', 'title')).toBe('Well-Known (X) Don’t');
});
