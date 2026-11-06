import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  brush: { color: '#ffffff', opacity: 1 } as Record<string, unknown>, composed: 0, sheet: new Uint8ClampedArray(0), toasts: [] as string[],
  fills: [] as unknown[][], secondary: [] as string[], reason: '',
}));
vi.mock('../src/store/store', () => ({
  useStore: { getState: () => ({ ui: { brush: h.brush, gradient: undefined } }) },
  setUi: (p: { brush: Record<string, unknown> }) => { h.brush = p.brush; },
  toast: (t: string) => { h.toasts.push(t); },
}));
vi.mock('../src/lib/media', () => ({ ctx2d: () => ({ getImageData: () => ({ data: h.sheet }) }) }));
vi.mock('../src/engine/design/sampleSource', () => ({ renderSource: () => { h.composed++; return h.reason || { canvas: {} }; } }));
vi.mock('../src/engine/design/fill', () => ({ fillRegion: (...a: unknown[]) => { h.fills.push(a); } }));
vi.mock('../src/engine/design/colorPair', () => ({ secondaryOf: () => '#000000', setSecondary: (c: string) => { h.secondary.push(c); } }));
vi.mock('../src/engine/design/swatches', async (orig) => ({
  ...await orig<typeof import('../src/engine/design/swatches')>(),
  rememberColor: () => undefined,
  sampleColor: (_d: unknown, _x: number, _y: number, o: { onReason?: (w: string) => void }) => { if (h.reason) o.onReason?.(h.reason); return h.reason ? null : '#010203'; },
}));

import { SHEET_MAX, beginSample, endSample, moveSample, runFill, samplingGesture } from '../src/components/designer/StageSample';
import type { DesignDoc } from '../src/engine/types';

const doc = { width: 2, height: 1 } as DesignDoc;
const none = { altKey: false, ctrlKey: false, shiftKey: false };

beforeEach(() => { h.brush = { color: '#ffffff', opacity: 1 }; h.composed = 0; h.toasts = []; h.fills = []; h.secondary = []; h.reason = ''; h.sheet = new Uint8ClampedArray([10, 20, 30, 255, 0, 0, 0, 0]); });

describe('samplingGesture', () => {
  it('the eyedropper always samples; Shift picks the secondary', () => {
    expect(samplingGesture('eyedropper', none)).toBe('primary');
    expect(samplingGesture('eyedropper', { ...none, shiftKey: true })).toBe('secondary');
  });
  it('color tools: Alt, or Ctrl+Shift; Lineart only with Ctrl+Shift (Alt bends a stroke)', () => {
    expect(samplingGesture('brush', { ...none, altKey: true })).toBe('primary');
    expect(samplingGesture('gradient', { ...none, altKey: true })).toBe('primary');
    expect(samplingGesture('lineart', { ...none, altKey: true })).toBeNull();
    expect(samplingGesture('lineart', { ...none, ctrlKey: true, shiftKey: true })).toBe('primary');
    expect(samplingGesture('text', { ...none, ctrlKey: true, shiftKey: true })).toBe('primary');
  });
  it('plain clicks, Ctrl alone (fill with the secondary), Shift alone and other tools do not sample', () => {
    expect(samplingGesture('brush', none)).toBeNull();
    expect(samplingGesture('fill', { ...none, ctrlKey: true })).toBeNull();
    expect(samplingGesture('fill', { ...none, shiftKey: true })).toBeNull();
    expect(samplingGesture('select', { ...none, altKey: true })).toBeNull();
    expect(samplingGesture('eraser', { ...none, altKey: true })).toBeNull();
  });
});

describe('live sampling', () => {
  it('a click composes nothing beyond the point read; the first move composes the sheet once, later moves only read it', () => {
    const d = beginSample(doc, { x: 0, y: 0 }, 'eyedropper', none)!;
    expect(h.composed).toBe(0);
    expect(moveSample(d, doc, { x: 0, y: 0 })).toBe('#0a141e');
    expect(moveSample(d, doc, { x: 1, y: 0 })).toBeNull();
    moveSample(d, doc, { x: 0.5, y: 0 }); moveSample(d, doc, { x: 5, y: 0 });
    expect(h.composed).toBe(1);
  });
  it('release commits the primary, or the secondary with Shift; transparent says so and changes nothing', () => {
    let d = beginSample(doc, { x: 0, y: 0 }, 'eyedropper', none)!;
    endSample(d, doc, { x: 0, y: 0 });
    expect(h.brush.color).toBe('#0a141e');
    d = beginSample(doc, { x: 0, y: 0 }, 'eyedropper', { ...none, shiftKey: true })!;
    endSample(d, doc, { x: 0, y: 0 });
    expect(h.secondary).toEqual(['#0a141e']);
    h.brush = { color: '#ffffff' };
    endSample(d, doc, { x: 1, y: 0 });
    expect(h.brush.color).toBe('#ffffff');
    expect(h.toasts[0]).toMatch(/Nothing to pick/);
  });
  it('an unreadable source is reported and no drag starts', () => {
    h.reason = 'Select a layer first, or sample all layers.';
    expect(beginSample(doc, { x: 0, y: 0 }, 'eyedropper', none)).toBeNull();
    expect(h.toasts).toEqual([h.reason]);
  });
  it('a page past the cap keeps no sheet', () => {
    expect(SHEET_MAX).toBe(16_000_000);
    const big = { width: 5000, height: 4000 } as DesignDoc;
    const d = beginSample(big, { x: 1, y: 1 }, 'eyedropper', none)!;
    moveSample(d, big, { x: 2, y: 2 }, true);
    expect(d.sheet).toBe(false);
    expect(h.composed).toBe(0);
  });
});

describe('runFill', () => {
  it('passes the tool settings; Ctrl uses the secondary; Shift flips Area for the click', () => {
    h.brush = { color: '#ff0000', opacity: 0.5, fillSource: 'layer', fillGap: 6, fillThreshold: 30, fillSimilar: false };
    runFill('s', doc, { x: 1, y: 2 }, none);
    expect(h.fills[0].slice(2, 6)).toEqual([1, 2, '#ff0000', 0.5]);
    expect(h.fills[0][6]).toMatchObject({ source: 'layer', gap: 6, threshold: 30, similar: false });
    runFill('s', doc, { x: 1, y: 2 }, { ...none, ctrlKey: true, shiftKey: true });
    expect(h.fills[1][4]).toBe('#000000');
    expect(h.fills[1][6]).toMatchObject({ similar: true });
  });
});
