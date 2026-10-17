import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
}));

import { captureOfAsset, saveCaptureStyle } from '../src/engine/captureLibrary';
import { captureLines } from '../src/engine/agent/captureContext';
import { withCaptureSetting } from '../src/engine/captureStyles';
import { withRealism } from '../src/engine/realism';
import { useStore } from '../src/store/store';
import type { Asset, Generation } from '../src/engine/types';

const put = (gen: Partial<Generation>, kind: 'image' | 'video' = 'image') => {
  const st = useStore.getState();
  const g = { id: 'g1', sessionId: st.activeSessionId, kind, prompt: 'A skater mid-air', modelRef: 'x', settings: { count: 1 }, inputs: { refs: [] }, status: 'done', assetIds: ['a1'], ...gen } as Generation;
  useStore.setState({ generations: { ...st.generations, g1: g }, assets: { ...st.assets, a1: { id: 'a1', kind, generationId: 'g1', sessionId: st.activeSessionId } as Asset } });
};

describe('guardar como estilo', () => {
  it('toma el CTLT de la captura del resultado, con el tono elegido', () => {
    put({ settings: { count: 1, advanced: {}, capture: { style: 'skate', tone: 'nostalgic, warm' } } });
    const c = captureOfAsset('a1');
    expect(c).toMatchObject({ tone: 'nostalgic, warm' });
    expect(c!.camera).toContain('12 mm fisheye');
  });
  it('sin captura toma la hoja de su registro (cotidiano = móvil)', () => {
    put({ settings: { count: 1, advanced: {}, realism: 'everyday' } });
    expect(captureOfAsset('a1')!.camera).toContain('Phone camera');
  });
  it('una operación o un asset sin generación no tienen estilo que guardar', () => {
    put({ op: { id: 'upscale', params: {}, sourceAssetId: 'a1' } as Generation['op'] });
    expect(captureOfAsset('a1')).toBeNull();
    expect(captureOfAsset('nope')).toBeNull();
  });
  it('se guarda en la biblioteca, sobrevive a la serialización y el agente lo usa por nombre', () => {
    put({ settings: { count: 1, advanced: {}, capture: { style: 'concealed' } } });
    const s = saveCaptureStyle('a1', 'Tarde oculta', true)!;
    expect(s).toMatchObject({ kind: 'style', name: 'Tarde oculta', frontalAssetId: 'a1' });
    // La misma ruta que el almacén: partialize → JSON → merge.
    const opts = useStore.persist.getOptions();
    const back = JSON.parse(JSON.stringify(opts.partialize!(useStore.getState())));
    const restored = opts.merge!(back, useStore.getInitialState()) as ReturnType<typeof useStore.getState>;
    const mine = restored.library.find((x) => x.name === 'Tarde oculta')!;
    expect(mine.capture?.camera).toContain('long lens');
    // "con mi estilo Tarde oculta": el plan lo resuelve por nombre y el prompt recibe su CTLT.
    const settings = withCaptureSetting({ count: 1 }, 'image', { style: 'Tarde oculta' }, restored.library) as unknown as { capture: never };
    expect(withRealism('Two friends', 'balanced', '', undefined, { kind: 'image', capture: settings.capture })).toContain('long lens from a distance');
    expect(captureLines(restored.library, restored.composer).join('\n')).toContain('Tarde oculta');
  });
  it('no pisa otro estilo sin replace ni un elemento que no es estilo; sin imagen no guarda referencia', () => {
    put({ settings: { count: 1, advanced: {}, capture: { style: 'phone' } } });
    expect(saveCaptureStyle('a1', 'Tarde oculta', false)).toBeNull();
    const again = saveCaptureStyle('a1', 'Tarde oculta', false, true)!;
    expect(again.frontalAssetId).toBeUndefined();
    expect(again.capture?.camera).toContain('phone main camera');
    useStore.setState((st) => ({ library: [...st.library, { id: 'c1', name: 'Mia', kind: 'character', refAssetIds: [] }] }));
    expect(saveCaptureStyle('a1', 'Mia', false, true)).toBeNull();
  });
});
