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
