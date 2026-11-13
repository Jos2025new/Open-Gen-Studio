// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined, peekAssetUrl: () => undefined, loadAssetUrl: async () => undefined }));
import type { DesignDoc, VectorLayer, VectorShape } from '../src/engine/types';
import { clickPick, groupShapes, pickable, shownLayer, validPicks } from '../src/engine/design/objectGroupTree';
import { vectorLayerHit } from '../src/engine/design/objectHit';
import { restackShapes } from '../src/engine/design/stackOrder';
import { docToSvg, type SvgDeps } from '../src/engine/design/export';
import { layerBox } from '../src/engine/design/render';
import { editableShapeAt } from '../src/engine/design/shapeLook';
import { layerObjects, objectAt, objectsBox, translateObjects } from '../src/engine/design/objectOps';
import { deletePicks, pickGroups } from '../src/engine/design/multiObjectOps';
import { marqueeFind } from '../src/engine/design/marqueePick';
import { addEmptyLayer, getDoc, newBlankDoc, patchLayer } from '../src/engine/design/actions';
import { objectPicks, setObjectPicks } from '../src/engine/design/objectSelection';
import { setObjectMeta } from '../src/engine/design/objectGroups';
import { useStore } from '../src/store/store';

const shape = (id: string, extra: Partial<VectorShape> = {}): VectorShape => ({ id, type: 'rect', x: 0, y: 0, w: 10, h: 10, radius: 0, fill: '#000', stroke: null, strokeWidth: 0, ...extra } as VectorShape);
const layer = (shapes: VectorShape[]): VectorLayer => ({ id: 'L', name: 'L', type: 'vector', visible: true, locked: false, opacity: 1, blend: 'normal', shapes } as unknown as VectorLayer);
const docOf = (l: VectorLayer): DesignDoc => ({ id: 'D', name: 'D', width: 1000, height: 1000, background: null, activeLayerId: l.id, createdAt: 0, updatedAt: 0, layers: [l] } as unknown as DesignDoc);
const deps: SvgDeps = { rasterHref: async () => null, layout: () => ({ lines: [], width: 0, lineHeightPx: 0 }), ascent: () => 0 };
/** a, b (locked) and c in one group; d loose. */
const lockedMember = () => {
  const g = groupShapes(layer([shape('a'), shape('b', { x: 20 }), shape('c', { x: 40 }), shape('d', { x: 60 })]), ['a', 'b', 'c'])!;
  return { groupId: g.groupId, l: { ...g.layer, shapes: g.layer.shapes.map((s) => (s.id === 'b' ? { ...s, locked: true } : s)) } as VectorLayer };
};

describe('hidden objects', () => {
  it('a hidden shape is exported as display:none (left out on request), and a named shape carries its label', async () => {
    const l = layer([shape('gone', { hidden: true, x: 700 }), shape('kept', { x: 50, name: 'Sun & moon' })]);
    const kept = new DOMParser().parseFromString(await docToSvg(docOf(l), deps), 'image/svg+xml');
    expect([...kept.querySelectorAll('g[id="L"] rect')].map((r) => [r.getAttribute('x'), r.getAttribute('display')])).toEqual([['700', 'none'], ['50', null]]);
    const svg = await docToSvg(docOf(l), deps, undefined, { hidden: false });
    const dom = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(dom.querySelector('parsererror')).toBeNull();
    const rects = [...dom.querySelectorAll('g[id="L"] rect')];
    expect(rects.map((r) => r.getAttribute('x'))).toEqual(['50']);
    expect(rects[0].getAttribute('inkscape:label')).toBe('Sun & moon');
    // The same document with nothing hidden exports both: the filter is what removed it.
    const both = await docToSvg(docOf(layer([shape('gone', { x: 700 }), shape('kept', { x: 50 })])), deps);
    expect(both).toContain('x="700"');
  });
  it('a shape hidden through its group is under display:none, and left out on request', async () => {
    const g = groupShapes(layer([shape('a', { x: 300 }), shape('b', { x: 400 }), shape('c', { x: 50 })]), ['a', 'b'])!;
    const off: VectorLayer = { ...g.layer, objectGroups: g.layer.objectGroups!.map((x) => ({ ...x, hidden: true })) };
    const full = new DOMParser().parseFromString(await docToSvg(docOf(off), deps), 'image/svg+xml');
    expect([...full.querySelectorAll('g[display="none"] rect')].map((r) => r.getAttribute('x'))).toEqual(['300', '400']);
    const svg = await docToSvg(docOf(off), deps, undefined, { hidden: false });
    expect(svg).not.toContain('x="300"');
    expect(svg).not.toContain('x="400"');
    expect(svg).toContain('x="50"');
  });
  it('a hidden shape far away does not count in any box, and is not hit', () => {
    const l = layer([shape('near'), shape('far', { x: 900, y: 900, hidden: true })]);
    expect(layerBox(l)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    expect(layerObjects(l).map((o) => o.id)).toEqual(['near']);
    expect(objectsBox(l, ['near', 'far'])).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    expect(vectorLayerHit(l, 905, 905)).toBe(false);
    expect(objectAt(l, 905, 905)).toBeNull();
    expect(layerBox(layer([shape('near'), shape('far', { x: 900, y: 900 })]))).toEqual({ x: 0, y: 0, w: 910, h: 910 });
  });
  it('shownLayer keeps its identity (render caches by it) and the layer itself when nothing is hidden', () => {
    const l = layer([shape('a', { hidden: true }), shape('b')]);
    expect(shownLayer(l)).toBe(shownLayer(l));
    const plain = layer([shape('a')]);
    expect(shownLayer(plain)).toBe(plain);
  });
});

describe('locked and hidden objects are not picked or edited', () => {
  it('a click, a marquee and a double click pass over them', () => {
    const l = layer([shape('under', { w: 100, h: 100 }), shape('lock', { locked: true }), shape('hide', { x: 50, hidden: true })]);
    expect(objectAt(l, 5, 5)).toBe('under');
    expect(clickPick(l, 'lock')).toEqual([]);
    expect(clickPick(l, 'hide')).toEqual([]);
    expect(marqueeFind(docOf(l), -5, -5, 200, 200).objects.get('L')).toEqual(['under']);
    // Double click: the locked shape on top has no edit mode and still covers the one under it; the hidden one is not there.
    expect(editableShapeAt(l, 5, 5)).toBeNull();
    expect(editableShapeAt(l, 55, 5)?.id).toBe('under');
    expect(editableShapeAt({ ...l, shapes: l.shapes.map((s) => ({ ...s, locked: false })) }, 5, 5)?.id).toBe('lock');
  });
  it('a locked or hidden group covers its members', () => {
    const g = groupShapes(layer([shape('a'), shape('b'), shape('c')]), ['a', 'b'])!;
    for (const flag of ['hidden', 'locked'] as const) {
      const off: VectorLayer = { ...g.layer, objectGroups: g.layer.objectGroups!.map((x) => ({ ...x, [flag]: true })) };
      expect(off.shapes.map((s) => pickable(off, s))).toEqual([false, false, true]);
      expect(clickPick(off, 'a')).toEqual([]);
      expect(editableShapeAt({ ...off, shapes: off.shapes.slice(0, 2) }, 5, 5)).toBeNull();
    }
  });
});

describe('a group with a locked member acts whole', () => {
  it('the member cannot be picked alone, but the group takes it along', () => {
    const { l } = lockedMember();
    expect(clickPick(l, 'b')).toEqual([]);
    expect(objectAt(l, 25, 5)).toBeNull();
    expect(clickPick(l, 'a')).toEqual(['a', 'b', 'c']);
    expect(validPicks(l, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(validPicks(l, ['b'])).toEqual([]);
  });
  it('moving and deleting the group move and delete the locked member too', () => {
    const { l } = lockedMember();
    const picks = [{ layerId: 'L', ids: clickPick(l, 'a') }];
    const groups = pickGroups(docOf(l), picks);
    expect(groups[0].ids).toEqual(['a', 'b', 'c']);
    const moved = translateObjects(l, groups[0].ids, 100, 0) as VectorLayer;
    expect(moved.shapes.map((s) => s.x)).toEqual([100, 120, 140, 60]);
    expect(objectsBox(l, groups[0].ids)).toEqual({ x: 0, y: 0, w: 50, h: 10 });
  });
  it('grouping and restacking keep it inside its group', () => {
    const { l, groupId } = lockedMember();
    const outer = groupShapes(l, ['a', 'c', 'd'])!;
    expect(outer.layer.objectGroups!.find((x) => x.id === groupId)!.parentId).toBe(outer.groupId);
    expect(outer.layer.shapes.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(restackShapes(l, ['a', 'c'], 'front')!.shapes.map((s) => s.id)).toEqual(['d', 'a', 'b', 'c']);
  });
});

describe('selection follows locks and visibility (store)', () => {
  let sid: string, docId: string, layerId: string;
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => null) as never);
    sid = useStore.getState().activeSessionId;
    useStore.setState((s) => ({ sessions: { ...s.sessions, [sid]: { ...s.sessions[sid], docs: [], activeDocId: null } } }));
    docId = newBlankDoc(sid, { label: 'Square', width: 1000, height: 1000 }).id;
    layerId = addEmptyLayer(sid, docId, 'vector')!;
    patchLayer(sid, docId, layerId, { shapes: [shape('a'), shape('b', { x: 20 })] } as never);
    setObjectPicks(docId, [{ layerId, ids: ['a', 'b'] }]);
  });
  it('locking the layer empties its selection; so does hiding it', () => {
    patchLayer(sid, docId, layerId, { locked: true });
    expect(objectPicks(docId)).toEqual([]);
    patchLayer(sid, docId, layerId, { locked: false });
    setObjectPicks(docId, [{ layerId, ids: ['a', 'b'] }]);
    patchLayer(sid, docId, layerId, { visible: false });
    expect(objectPicks(docId)).toEqual([]);
  });
  it('locking or hiding one shape takes only that shape out', () => {
    setObjectMeta(sid, docId, layerId, 'a', { locked: true });
    expect(objectPicks(docId)).toEqual([{ layerId, ids: ['b'] }]);
    setObjectMeta(sid, docId, layerId, 'b', { hidden: true });
    expect(objectPicks(docId)).toEqual([]);
    setObjectMeta(sid, docId, layerId, 'a', { locked: false });
    const l = getDoc(sid, docId)!.layers.find((x) => x.id === layerId) as VectorLayer;
    expect(l.shapes[0]).not.toHaveProperty('locked');
  });
  it('deleting a picked group deletes its locked member with it', () => {
    const { l } = lockedMember();
    patchLayer(sid, docId, layerId, { shapes: l.shapes, objectGroups: l.objectGroups } as never);
    const doc = getDoc(sid, docId)!, cur = doc.layers.find((x) => x.id === layerId) as VectorLayer;
    deletePicks(sid, docId, doc, [{ layerId, ids: clickPick(cur, 'a') }]);
    expect((getDoc(sid, docId)!.layers.find((x) => x.id === layerId) as VectorLayer).shapes.map((s) => s.id)).toEqual(['d']);
  });
});
