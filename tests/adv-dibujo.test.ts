// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined, peekAssetUrl: () => undefined, loadAssetUrl: async () => undefined }));
import { addEmptyLayer, getDoc, newBlankDoc, patchLayer, setActiveLayer } from '../src/engine/design/actions';
import { drawShape, placeShape, shapeTarget } from '../src/engine/design/drawShape';
import { objectPicks, setObjectPick } from '../src/engine/design/objectSelection';
import { useStore } from '../src/store/store';
import type { DesignDoc, VectorLayer, VectorShape } from '../src/engine/types';

/* Ataques a dibujar en la capa activa: capa activa ausente o desfasada, documento inexistente, grupos, selección previa. */

const shape = (id: string, x = 0, extra: Record<string, unknown> = {}): VectorShape =>
  ({ id, type: 'rect', x, y: 0, w: 10, h: 10, radius: 0, fill: '#000', stroke: null, strokeWidth: 0, ...extra }) as VectorShape;

let sid: string, docId: string;
const doc = (): DesignDoc => getDoc(sid, docId)!;

beforeEach(() => {
  sid = useStore.getState().activeSessionId;
  useStore.setState((s) => ({ sessions: { ...s.sessions, [sid]: { ...s.sessions[sid], docs: [], activeDocId: null } } }));
  docId = newBlankDoc(sid, { label: 'Lienzo', width: 1000, height: 1000 }).id;
});

describe('dibujar: casos de borde de la capa activa', () => {
  it('documento inexistente: devuelve null y no revienta', () => {
    expect(drawShape(sid, 'no-existe', shape('a'))).toBeNull();
  });

  it('sin capa activa (activeLayerId null): crea una capa y deja la forma picada', () => {
    setActiveLayer(sid, docId, null);
    const layerId = drawShape(sid, docId, shape('a'));
    expect(layerId).toBeTruthy();
    expect((doc().layers.find((l) => l.id === layerId) as VectorLayer).shapes.map((s) => s.id)).toEqual(['a']);
    expect(objectPicks(docId)).toEqual([{ layerId, ids: ['a'] }]);
  });

  it('capa activa desfasada (id de una capa borrada): no escribe en otra capa, crea una nueva', () => {
    const before = doc().layers.length;
    const old = addEmptyLayer(sid, docId, 'vector')!;
    setActiveLayer(sid, docId, 'fantasma');
    const layerId = drawShape(sid, docId, shape('a'))!;
    expect(layerId).not.toBe(old);
    expect(doc().layers.length).toBe(before + 2);
    expect((doc().layers.find((l) => l.id === old) as VectorLayer).shapes).toEqual([]);
  });

  it('placeShape en un documento sin capas crea la primera capa con la forma', () => {
    const empty = { ...doc(), layers: [], activeLayerId: null };
    const placed = placeShape(empty, shape('a'));
    expect(placed.created).toBe(true);
    expect(placed.doc.layers).toHaveLength(1);
    expect((placed.doc.layers[0] as VectorLayer).shapes.map((s) => s.id)).toEqual(['a']);
  });

  it('dibujar no toca las capas ajenas (mismas referencias de objeto)', () => {
    const other = addEmptyLayer(sid, docId, 'vector')!;
    patchLayer(sid, docId, other, { shapes: [shape('o')] } as never);
    const target = addEmptyLayer(sid, docId, 'vector')!;
    const snapshot = doc().layers.map((l) => [l.id, l] as const);
    const placed = placeShape({ ...doc(), activeLayerId: target }, shape('a'));
    for (const [id, l] of snapshot) if (id !== target) expect(placed.doc.layers.find((x) => x.id === id)).toBe(l);
  });

  it('dibujar en una capa con grupos no hereda grupo y mantiene el grupo existente contiguo', () => {
    const layer = addEmptyLayer(sid, docId, 'vector')!;
    const g = { id: 'G', name: 'G' };
    patchLayer(sid, docId, layer, { shapes: [shape('m1', 0, { groupId: 'G' }), shape('m2', 0, { groupId: 'G' })], objectGroups: [g] } as never);
    setActiveLayer(sid, docId, layer);
    const placed = placeShape(doc(), shape('new'));
    const l = placed.doc.layers.find((x) => x.id === layer) as VectorLayer;
    expect(l.objectGroups).toEqual([g]);
    expect(l.shapes.map((s) => [s.id, s.groupId])).toEqual([['m1', 'G'], ['m2', 'G'], ['new', undefined]]);
  });

  it('una pick previa en otra capa se sustituye por la forma nueva (no quedan dos objetos picados)', () => {
    const a = drawShape(sid, docId, shape('a'))!;
    setObjectPick(docId, { layerId: a, ids: ['a'] });
    const other = addEmptyLayer(sid, docId, 'vector')!;
    setActiveLayer(sid, docId, other);
    drawShape(sid, docId, shape('b'));
    expect(objectPicks(docId).map((p) => p.ids).flat()).toEqual(['b']);
  });

  it('shapeTarget ignora una capa de vector con máscara de píxeles aunque esté visible', () => {
    const layer = addEmptyLayer(sid, docId, 'vector')!;
    patchLayer(sid, docId, layer, { pixelMask: { id: 'm' } } as never);
    setActiveLayer(sid, docId, layer);
    expect(shapeTarget(doc())).toBeNull();
  });

  it('coordenadas extremas (NaN, Infinity) se guardan sin cambiar el número de formas de las capas', () => {
    const layerId = drawShape(sid, docId, shape('nan', NaN))!;
    drawShape(sid, docId, shape('inf', Infinity));
    expect((doc().layers.find((l) => l.id === layerId) as VectorLayer).shapes.map((s) => s.id)).toEqual(['nan', 'inf']);
  });

});
