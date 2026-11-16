import { describe, expect, it } from 'vitest';
import { ensureOmniNodes } from '../src/engine/nodes/omni';
import { linkSystemNodes, setLinkBoth } from '../src/engine/nodes/system';
import { travelGraph } from '../src/engine/flow/history';
import { newSession, setGraph, useStore } from '../src/store/store';

const get = useStore.getState;
const graphOf = (sid: string) => get().sessions[sid].graph;
const travel = (sid: string, dir: 'undo' | 'redo') => travelGraph(sid, graphOf(sid), dir, 1, (g) => { setGraph(sid, () => g); return true; });
const SRC = 'sys_space_studio';
const TGT = 'sys_space_nodes';
const between = (sid: string, kind: string) => graphOf(sid).edges.filter((e) => e.source === SRC && e.target === TGT && (e.kind ?? 'data') === kind);

describe('omnicanvas links between two nodes: create, both, undo, redo', () => {
  for (const kind of ['data', 'ref', 'control'] as const) {
    it(`${kind} link: create, ${kind === 'data' ? 'both is refused' : 'toggle both'}, undo and redo each step`, () => {
      const sid = newSession();
      ensureOmniNodes(sid);
      expect(between(sid, kind)).toHaveLength(0);
      const made = linkSystemNodes(sid, { source: SRC, target: TGT, kind });
      expect(made.error).toBeNull();
      const id = made.edgeId!;
      expect(between(sid, kind)).toHaveLength(1);

      if (kind === 'data') {
        expect(setLinkBoth(sid, id, true)).toMatch(/cannot be bidirectional/);
        expect(between(sid, kind)[0].both).toBeUndefined();
      } else {
        expect(setLinkBoth(sid, id, true)).toBeNull();
        expect(between(sid, kind)[0].both).toBe(true);
        expect(travel(sid, 'undo')).toBe(true);
        expect(between(sid, kind)[0].both).toBeUndefined();
        expect(travel(sid, 'redo')).toBe(true);
        expect(between(sid, kind)[0].both).toBe(true);
        expect(setLinkBoth(sid, id, false)).toBeNull();
        expect(between(sid, kind)[0].both).toBeUndefined();
        expect(travel(sid, 'undo')).toBe(true);
        expect(between(sid, kind)[0].both).toBe(true);
        expect(travel(sid, 'undo')).toBe(true);
      }
      // Undo removes the link; redo brings it back with the same id.
      expect(between(sid, kind)).toHaveLength(1);
      expect(travel(sid, 'undo')).toBe(true);
      expect(between(sid, kind)).toHaveLength(0);
      expect(travel(sid, 'redo')).toBe(true);
      expect(between(sid, kind).map((e) => e.id)).toEqual([id]);
    });
  }

  it('the three kinds coexist between the same two nodes and undo only removes the last one', () => {
    const sid = newSession();
    ensureOmniNodes(sid);
    for (const kind of ['data', 'ref', 'control'] as const) expect(linkSystemNodes(sid, { source: SRC, target: TGT, kind }).error).toBeNull();
    expect(graphOf(sid).edges.filter((e) => e.source === SRC && e.target === TGT)).toHaveLength(3);
    travel(sid, 'undo');
    expect(between(sid, 'control')).toHaveLength(0);
    expect(between(sid, 'ref')).toHaveLength(1);
    expect(between(sid, 'data')).toHaveLength(1);
  });
});
