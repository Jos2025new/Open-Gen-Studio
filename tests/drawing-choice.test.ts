import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignDoc, RasterLayer } from '../src/engine/types';

// The store, the actions and the pixel buffers are replaced: the test checks what each choice writes, and that it is one
// undo step. Real pixel equality of the flattened layer needs a canvas, which the test setup does not have.
const fx = vi.hoisted(() => ({
  doc: null as unknown as DesignDoc,
  updates: [] as Array<(d: DesignDoc) => DesignDoc>,
  recorded: 0,
  active: [] as string[],
  ui: {} as Record<string, unknown>,
  toasts: [] as string[],
}));
vi.mock('../src/store/store', () => ({
  setDoc: (_s: string, _d: string, fn: (d: DesignDoc) => DesignDoc) => { fx.updates.push(fn); },
  setUi: (patch: Record<string, unknown>) => { Object.assign(fx.ui, patch); },
  toast: (text: string) => { fx.toasts.push(text); },
  useStore: { getState: () => ({ ui: fx.ui }) },
}));
vi.mock('../src/engine/design/actions', () => ({
  getDoc: () => fx.doc,
  setActiveLayer: (_s: string, _d: string, id: string) => { fx.active.push(id); },
}));
vi.mock('../src/engine/design/history', () => ({ record: () => { fx.recorded++; } }));
vi.mock('../src/engine/design/raster', () => ({ setBuffer: () => undefined }));
vi.mock('../src/lib/media', () => ({ createCanvas: () => ({}) }));

import { createDoc } from '../src/engine/design/doc';
import { applyDrawingChoice, cancelDrawingChoice, drawingPreference, pendingChoiceIn, requestDrawingChoice, setDrawingPreference, pendingDrawingChoiceLayer } from '../src/engine/design/drawingChoice';

const stroke = { id: 's', segments: [], x: 0, y: 0, color: '#000', opacity: 1, erase: false };
const editable = (): RasterLayer => ({ id: 'L', type: 'raster', name: 'Ink', visible: true, locked: false, opacity: 1, blend: 'normal', x: 0, y: 0, width: 10, height: 10, pxWidth: 10, pxHeight: 10, rev: 0, paintStrokes: [stroke, { ...stroke, id: 't' }] } as unknown as RasterLayer);
const docOf = (extra: Partial<DesignDoc> = {}): DesignDoc => ({ ...createDoc('d', 10, 10), paintMode: undefined, layers: [editable()], activeLayerId: 'L', ...extra });
const apply = (d: DesignDoc, fn: (x: DesignDoc) => DesignDoc) => fn(d);

beforeEach(() => {
  fx.doc = docOf(); fx.updates = []; fx.recorded = 0; fx.active = []; fx.ui = {}; fx.toasts = [];
  cancelDrawingChoice();
});

describe('painting on a layer with editable strokes in Drawing', () => {
  it('Flatten and paint: the strokes become pixels in one undo step, and the toast names the count', () => {
    const message = applyDrawingChoice('s', 'd', 'L', 'flatten');
    expect(message).toBe('Flattened 2 strokes · Undo');
    expect(fx.recorded).toBe(1);
    const after = apply(fx.doc, fx.updates[0]).layers[0] as RasterLayer;
    expect(after.paintFlattened).toBe(true);
    expect(after.paintStrokes).toBeUndefined();
    expect(after.paintBaseId).toBeUndefined();
    expect(after.rev).toBe(1);
  });

  it('Paint in Design: the document switches to Design and the layer keeps its strokes', () => {
    const message = applyDrawingChoice('s', 'd', 'L', 'design');
    expect(message).toMatch(/Design mode/);
    expect(fx.recorded).toBe(1);
    const after = apply(fx.doc, fx.updates[0]);
    expect(after.paintMode).toBe('design');
    expect((after.layers[0] as RasterLayer).paintStrokes).toHaveLength(2);
  });

  it('New layer: a raster layer is added above, selected, and the stroke goes there', () => {
    const message = applyDrawingChoice('s', 'd', 'L', 'newLayer');
    expect(message).toMatch(/new layer/);
    expect(fx.recorded).toBe(1);
    const after = apply(fx.doc, fx.updates[0]);
    expect(after.layers).toHaveLength(2);
    expect(after.layers[1].type).toBe('raster');
    expect(fx.active).toHaveLength(1);
  });

  it('closing the prompt without choosing changes nothing and records nothing', () => {
    requestDrawingChoice('L');
    expect(pendingDrawingChoiceLayer()).toBe('L');
    expect(pendingChoiceIn(fx.doc)?.id).toBe('L');
    cancelDrawingChoice();
    expect(pendingDrawingChoiceLayer()).toBeNull();
    expect(fx.updates).toHaveLength(0);
    expect(fx.recorded).toBe(0);
  });
});

describe('the remembered choice', () => {
  it('is saved as the preference and read back, so it is applied without asking', () => {
    expect(drawingPreference()).toBe('ask');
    setDrawingPreference('flatten');
    expect(fx.ui.drawingChoice).toBe('flatten');
    expect(drawingPreference()).toBe('flatten');
  });

  it('Settings «Ask every time» brings the prompt back', () => {
    setDrawingPreference('newLayer');
    setDrawingPreference('ask');
    expect(drawingPreference()).toBe('ask');
  });
});
