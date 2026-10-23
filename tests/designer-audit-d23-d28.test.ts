import { afterEach, describe, expect, it, vi } from 'vitest';
const dom = vi.hoisted(() => {
  const handlers: Record<string, (e: unknown) => void> = {};
  Object.assign(globalThis, { Element: class {},
    window: globalThis, addEventListener() {}, getSelection: () => null,
    document: { addEventListener: (t: string, h: (e: unknown) => void) => { handlers[t] = h; }, removeEventListener() {} },
    ClipboardItem: class { constructor(public items: unknown) {} },
  });
  return { handlers, cleared: 0 };
});
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined }, blobDb: { set: async () => undefined } }));
vi.mock('../src/lib/media', async () => {
  const { pixelCanvas } = await import('./helpers/pixelCanvas');
  return { createCanvas: pixelCanvas, ctx2d: (c: HTMLCanvasElement) => c.getContext('2d'), canvasToBlob: async () => new Blob() };
});
vi.mock('../src/engine/design/pixelSelection', () => ({
  clearSelected: () => { dom.cleared++; return null; }, getSelection: () => ({}), selectedCrop: () => ({ width: 1, height: 1 }),
}));
import { designerClipboard } from '../src/components/designer/designerClipboard';
import { createDoc } from '../src/engine/design/doc';
import { useStore } from '../src/store/store';

const toasts = () => useStore.getState().ui.toasts.map((t) => t.text);
const settle = () => new Promise((r) => setTimeout(r, 0));
afterEach(() => { useStore.setState((s) => ({ ui: { ...s.ui, toasts: [] } })); dom.cleared = 0; });

describe('D23: cut deletes only after the copy is confirmed', () => {
  const cut = async (write: () => Promise<void>) => {
    vi.stubGlobal('navigator', { clipboard: { write } });
    designerClipboard('s', createDoc('d', 8, 8));
    dom.handlers.cut({ type: 'cut', defaultPrevented: false, target: null, preventDefault() {} });
    await settle();
  };
  it('deletes nothing and shows the error when the clipboard write fails', async () => {
    await cut(() => Promise.reject(new Error('denied')));
    expect(dom.cleared).toBe(0);
    expect(toasts()).toContain('Could not copy image to the clipboard.');
  });
  it('deletes once the write is confirmed', async () => {
    await cut(() => Promise.resolve());
    expect(dom.cleared).toBe(1);
  });
});

import { addDoc, getDoc } from '../src/engine/design/actions';
import { newRasterLayer } from '../src/engine/design/doc';
import { commitStagePaintGesture } from '../src/components/designer/StagePaintCommit';
import { dropHistory, record } from '../src/engine/design/history';
import { flushRaster, setBuffer } from '../src/engine/design/raster';
import { pixelCanvas } from './helpers/pixelCanvas';
import { place } from '../src/engine/design/rasterSurface';
import type { RasterLayer, RasterStroke } from '../src/engine/types';
import type { BrushOptions } from '../src/engine/design/brushEngine';
import type { LiveStroke } from '../src/engine/design/raster';

const stroke = (id: string): RasterStroke => ({ id, x: 0, y: 0, color: '#ffffff', opacity: 1, erase: false, segments: [[1, 1, 2, 1, 1]] });
const paintOn = (layer: RasterLayer, clipped: boolean) => {
  const sid = useStore.getState().activeSessionId;
  const doc = { ...createDoc('d24', 8, 8), layers: [layer], activeLayerId: layer.id };
  const c = pixelCanvas(8, 8);
  setBuffer(layer.id, place(c as unknown as HTMLCanvasElement, { x0: 0, y0: 0, fw: 8, fh: 8 }));
  addDoc(sid, doc);
  record(getDoc(sid, doc.id)!);
  commitStagePaintGesture({
    sessionId: sid, docId: doc.id, clipped, flushFrame: () => undefined, brush: { taperEnd: 0 } as BrushOptions,
    gesture: { kind: 'paint', live: {} as LiveStroke, stroke: stroke('n'), layerId: layer.id, last: { x: 1, y: 1 }, control: { x: 1, y: 1 }, time: 0, erase: false },
  });
  dropHistory(doc.id);
};
const base = () => ({ ...newRasterLayer('Paint', { x: 0, y: 0, width: 8, height: 8 }, { width: 8, height: 8 }), paintStrokes: [stroke('a')] });
const FLATTENED = 'Strokes flattened to pixels. Undo restores editable strokes.';

describe('D24: painting inside a selection says it flattened the strokes', () => {
  afterEach(() => flushRaster());
  it('shows the flatten notice when editable strokes are lost', () => {
    paintOn(base(), true);
    expect(toasts()).toContain(FLATTENED);
  });
  it('shows nothing when the layer had no editable strokes', () => {
    paintOn({ ...base(), paintStrokes: undefined }, true);
    expect(toasts()).not.toContain(FLATTENED);
  });
});
