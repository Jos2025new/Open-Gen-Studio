import { describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';

const state = vi.hoisted(() => ({ result: null as unknown, found: new Map<string, string[]>() }));
vi.mock('../src/engine/design/marqueePick', () => ({ marqueeFind: () => ({ layers: ['L'], objects: state.found }) }));
vi.mock('../src/engine/design/actions', () => ({ getDoc: () => null, setActiveLayer: vi.fn() }));
vi.mock('../src/engine/design/selection', () => ({ setLayerPicks: vi.fn(), layerSelection: () => [] }));
vi.mock('../src/engine/design/objectSelection', () => ({ objectPicks: () => [], pickedIn: () => [], setObjectPick: vi.fn(), setObjectPicks: (_p: unknown, value: unknown) => { state.result = value; } }));
import { finishEditMarquee } from '../src/components/designer/StageEditMarquee';

const layer = { id: 'L', type: 'vector', shapes: [{ id: 'a', groupId: 'g' }, { id: 'b', groupId: 'g' }], strokes: [{ id: 'stroke' }], objectGroups: [{ id: 'g', name: 'Group' }] } as any;

describe('object selection regressions', () => {
  it('keeps vector strokes found by the marquee', () => {
    state.found = new Map([['L', ['stroke']]]);
    finishEditMarquee({ doc: { id: 'd', layers: [layer], activeLayerId: 'L' } as any, sessionId: 's', zoom: 1, drag: { kind: 'editMarquee', mode: 'objects', combine: 'replace', startX: 0, startY: 0, x: 20, y: 20 } });
    expect(state.result).toEqual([{ layerId: 'L', ids: ['stroke'] }]);
  });
});
