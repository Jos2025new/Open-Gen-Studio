import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = { doc: null as unknown, reads: [] as string[], pixels: null as Uint8ClampedArray | null, put: null as Uint8ClampedArray | null, toasts: [] as string[] };
  return state;
});
vi.mock('../src/store/store', () => ({
  setDoc: (_s: string, _d: string, fn: (d: unknown) => unknown) => { h.doc = fn(h.doc); },
  toast: (t: string) => { h.toasts.push(t); },
}));
vi.mock('../src/lib/media', () => ({
  createCanvas: (w: number, hh: number) => ({ width: w, height: hh }),
  ctx2d: () => ({
    getImageData: () => ({ data: h.pixels }),
    createImageData: (w: number, hh: number) => ({ data: new Uint8ClampedArray(w * hh * 4) }),
    putImageData: (img: { data: Uint8ClampedArray }) => { h.put = img.data; },
    clearRect() {}, drawImage() {}, fillRect() {},
  }),
}));
vi.mock('../src/engine/design/sampleSource', () => ({
  renderSource: (_d: unknown, source: string, o: { origin: string }) => {
    h.reads.push(`${source}:${o.origin}`);
    return source === 'layer' && !(h.doc as { activeLayerId: string | null }).activeLayerId ? 'Select a layer first, or sample all layers.' : { canvas: { width: 3, height: 1 } };
  },
}));
vi.mock('../src/engine/design/raster', () => ({ setBuffer: () => undefined }));
vi.mock('../src/engine/design/history', () => ({ record: () => undefined }));
vi.mock('../src/engine/design/pixelSelection', () => ({ getSelection: () => null, selectionMask: () => ({}) }));

import { fillRegion } from '../src/engine/design/fill';
import { createDoc, insertLayer, newRasterLayer } from '../src/engine/design/doc';
import type { DesignDoc } from '../src/engine/types';

const strip = (rgb: number[][]) => new Uint8ClampedArray(rgb.flatMap(([r, g, b]) => [r, g, b, 255]));
const names = () => (h.doc as DesignDoc).layers.map((l) => l.name);

beforeEach(() => {
  let d = createDoc('d', 3, 1);
  d = insertLayer(d, newRasterLayer('Line', { x: 0, y: 0, width: 3, height: 1 }, { width: 3, height: 1 }), 'top');
  d = insertLayer(d, newRasterLayer('Top', { x: 0, y: 0, width: 3, height: 1 }, { width: 3, height: 1 }), 'top');
  d = { ...d, activeLayerId: d.layers.find((l) => l.name === 'Line')!.id };
  h.doc = d; h.reads = []; h.put = null; h.toasts = [];
  h.pixels = strip([[200, 0, 0], [0, 0, 0], [200, 0, 0]]);
});

describe('Fill source and placement', () => {
  const run = (o: Parameters<typeof fillRegion>[6]) => fillRegion('s', h.doc as DesignDoc, 0, 0, '#112233', 1, o);
  it('default: reads all visible with the literal origin and lands on top, as before', () => {
    run({});
    expect(h.reads).toEqual(['all:fill']);
    expect(names().at(-1)).toBe('Fill');
  });
  it('source layer: reads the active layer and lands right under it', () => {
    run({ source: 'layer' });
    expect(h.reads).toEqual(['layer:fill']);
    const n = names();
    expect(n.indexOf('Fill')).toBe(n.indexOf('Line') - 1);
  });
  it('no layer to read: throws the reason', () => {
    h.doc = { ...(h.doc as DesignDoc), activeLayerId: null };
    expect(() => run({ source: 'layer' })).toThrow('Select a layer first');
  });
  it('similar fills disconnected matches; connected does not', () => {
    run({ similar: true, threshold: 10 });
    expect([...h.put!.filter((_, i) => i % 4 === 3)]).toEqual([255, 0, 255]);
    run({ threshold: 10 });
    expect([...h.put!.filter((_, i) => i % 4 === 3)]).toEqual([255, 0, 0]);
  });
  it('gap with a seed hugging the line falls back and says so', () => {
    h.pixels = strip([[200, 0, 0], [0, 0, 0], [200, 0, 0]]);
    run({ gap: 4, threshold: 10 });
    expect(h.toasts[0]).toMatch(/close gaps/);
    expect([...h.put!.filter((_, i) => i % 4 === 3)]).toEqual([255, 0, 0]);
  });
});
