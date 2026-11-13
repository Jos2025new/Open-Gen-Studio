import { describe, expect, it } from 'vitest';
import type { ObjectGroup, VectorLayer, VectorShape } from '../src/engine/types';
import { clickPick, expandPicks, groupShapes, liveObjectGroups, shapesSvgTree, shownLayer, validPicks } from '../src/engine/design/objectGroupTree';
import { layerObjects, objectAt } from '../src/engine/design/objectOps';
import { restackShapes } from '../src/engine/design/stackOrder';

/*
 * Time budget of the group tree (docs/diagnostico-modelo-objetos.md). Groups of 5 shapes inside groups of 4 groups.
 * The answers come from one index per layer, so every operation is linear: a few ms at 4000 shapes. Before the index
 * the same calls took 5–25 s at 1000 shapes. The limit is wide (machine load) and still far below a quadratic run.
 */
function grouped(n: number): VectorLayer {
  const shapes: VectorShape[] = [], groups = new Map<string, ObjectGroup>();
  for (let i = 0; i < n; i++) {
    const g = Math.floor(i / 5), o = `o${Math.floor(g / 4)}`;
    groups.set(o, { id: o, name: 'O' }); groups.set(`g${g}`, { id: `g${g}`, name: 'G', parentId: o });
    shapes.push({ id: `s${i}`, groupId: `g${g}`, type: 'rect', x: (i % 100) * 12, y: Math.floor(i / 100) * 12, w: 10, h: 10, radius: 0, fill: '#000', stroke: null, strokeWidth: 0 } as VectorShape);
  }
  return { id: 'L', name: 'L', type: 'vector', visible: true, locked: false, opacity: 1, blend: 'normal', shapes, objectGroups: [...groups.values()] } as unknown as VectorLayer;
}
const ms = (fn: () => unknown) => { const t = performance.now(); fn(); return performance.now() - t; };
const BUDGET = 400;

describe('group tree: time budget', () => {
  for (const n of [1000, 4000]) it(`${n} grouped shapes: every operation is linear`, () => {
    const base = grouped(n), ids = base.shapes.map((s) => s.id);
    // A fresh layer object per operation: nothing is paid for by an earlier call.
    const fresh = () => ({ ...base });
    const took: Record<string, number> = {
      validAll: ms(() => expect(validPicks(fresh(), ids)).toHaveLength(n)),
      expandAll: ms(() => expect(expandPicks(fresh(), ids)).toHaveLength(n)),
      clickEach: ms(() => { const l = fresh(); for (const id of ids) clickPick(l, id); }),
      groupTen: ms(() => expect(groupShapes(fresh(), ids.slice(0, 10))).not.toBeNull()),
      groupAll: ms(() => expect(groupShapes(fresh(), ids)).not.toBeNull()),
      live: ms(() => expect(liveObjectGroups(fresh())).toHaveLength(base.objectGroups!.length)),
      restack: ms(() => restackShapes(fresh(), ['s0'], 'front')),
      shown: ms(() => shownLayer({ ...base, shapes: base.shapes.map((s, i) => (i ? s : { ...s, hidden: true })) })),
      objects: ms(() => expect(layerObjects(fresh())).toHaveLength(n)),
      hit: ms(() => expect(objectAt(fresh(), 5, 5)).toBe('s0')),
      svg: ms(() => shapesSvgTree(fresh(), () => '', (x) => x)),
    };
    for (const [name, t] of Object.entries(took)) expect(t, `${name} at ${n} shapes took ${t.toFixed(0)} ms`).toBeLessThan(BUDGET);
  });
  it('one group of 4000 shapes, all picked, is read once', () => {
    const base = grouped(4000), one: VectorLayer = { ...base, shapes: base.shapes.map((s) => ({ ...s, groupId: 'all' })), objectGroups: [{ id: 'all', name: 'All' }] };
    const ids = one.shapes.map((s) => s.id);
    expect(ms(() => expect(validPicks(one, ids)).toHaveLength(4000))).toBeLessThan(BUDGET);
    expect(ms(() => expect(expandPicks({ ...one }, ids)).toHaveLength(4000))).toBeLessThan(BUDGET);
  });
});
