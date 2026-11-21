import { describe, expect, it } from 'vitest';
import { graphHistory, recordGraph, travelGraph } from '../src/engine/flow/history';
import type { Graph } from '../src/engine/types';
const graph = (text: string): Graph => ({ nodes: [{ id: 'a', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'Prompt', text } }], edges: [] });
describe('node graph history', () => {
  it('keeps sessions separate and jumps through undo and redo independently', () => {
    const a = graph('a'), b = { ...graph('b'), nodes: [...graph('b').nodes, { id: 'b', position: { x: 0, y: 0 }, data: { kind: 'text' as const, title: 'Second', text: '' } }] }, c = { ...b, edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'text', targetHandle: 'prompt' }] };
    recordGraph('jumps', a, b); recordGraph('jumps', b, c);
    expect(graphHistory('other', 'undo')).toHaveLength(0);
    let current = c;
    expect(travelGraph('jumps', current, 'undo', 2, g => { current = g; return true; })).toBe(true);
    expect(current.nodes).toEqual(a.nodes);
    expect(graphHistory('jumps', 'undo')).toHaveLength(0);
    expect(graphHistory('jumps', 'redo')).toHaveLength(2);
    travelGraph('jumps', current, 'redo', 2, g => { current = g; return true; });
    expect(current).toEqual(c);
  });
  it('coalesces typing and clears redo after a new edit', () => {
    recordGraph('typing', graph(''), graph('a')); recordGraph('typing', graph('a'), graph('ab'));
    expect(graphHistory('typing', 'undo')).toHaveLength(1);
    travelGraph('typing', graph('ab'), 'undo', 1, () => true);
    recordGraph('typing', graph(''), graph('new'));
    expect(graphHistory('typing', 'redo')).toHaveLength(0);
  });
  it('does not consume history if the edit guard refuses restoration', () => {
    recordGraph('locked', graph('a'), graph('b'));
    expect(travelGraph('locked', graph('b'), 'undo', 1, () => false)).toBe(false);
    expect(graphHistory('locked', 'undo')).toHaveLength(1);
    expect(graphHistory('locked', 'redo')).toHaveLength(0);
  });
  it('ignores viewport and generation updates and preserves the latest output', () => {
    const a: Graph = { nodes: [{ id: 'im', position: { x: 0, y: 0 }, data: { kind: 'tool', title: 'Edit', op: 'relight', params: { prompt: 'a' }, generationId: 'old', outputIndex: 0 } }], edges: [] };
    const b: Graph = { ...a, nodes: [{ ...a.nodes[0], data: { ...a.nodes[0].data, title: 'Renamed' } }] };
    const c: Graph = { ...b, viewport: { x: 30, y: 20, zoom: 0.5 }, nodes: [{ ...b.nodes[0], data: { ...b.nodes[0].data, generationId: 'new' } as never }] };
    recordGraph('outputs', a, b); recordGraph('outputs', b, c);
    expect(graphHistory('outputs', 'undo')).toHaveLength(1);
    let restored = c;
    travelGraph('outputs', c, 'undo', 1, g => { restored = g; return true; });
    expect(restored.nodes[0].data.title).toBe('Edit');
    expect((restored.nodes[0].data as { generationId: string }).generationId).toBe('new');
    expect(restored.viewport).toEqual(c.viewport);
  });

  it('records group-only changes (create, rename, color, ungroup) and does not merge them with moves', () => {
    const a: Graph = {
      nodes: [
        { id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'A', text: '' } },
        { id: 'n2', position: { x: 200, y: 0 }, data: { kind: 'text', title: 'B', text: '' } },
      ],
      edges: [],
    };
    const moved: Graph = {
      ...a,
      nodes: [{ ...a.nodes[0], position: { x: 50, y: 0 } }, a.nodes[1]],
    };
    const grouped: Graph = { ...moved, groups: [{ id: 'g1', title: 'Group 1', nodeIds: ['n1', 'n2'] }] };
    const renamed: Graph = { ...grouped, groups: [{ id: 'g1', title: 'Scene', nodeIds: ['n1', 'n2'] }] };
    const colored: Graph = { ...renamed, groups: [{ id: 'g1', title: 'Scene', nodeIds: ['n1', 'n2'], color: '#5ec8ff' }] };
    const ungrouped: Graph = { ...colored, groups: [] };

    recordGraph('groups-test', a, moved);
    recordGraph('groups-test', moved, grouped);
    recordGraph('groups-test', grouped, renamed);
    recordGraph('groups-test', renamed, colored);
    recordGraph('groups-test', colored, ungrouped);

    expect(graphHistory('groups-test', 'undo')).toHaveLength(5);

    let current = ungrouped;
    expect(travelGraph('groups-test', current, 'undo', 1, (g) => { current = g; return true; })).toBe(true);
    expect(current.groups).toEqual(colored.groups);
    expect(travelGraph('groups-test', current, 'undo', 1, (g) => { current = g; return true; })).toBe(true);
    expect(current.groups).toEqual(renamed.groups);
    expect(travelGraph('groups-test', current, 'undo', 1, (g) => { current = g; return true; })).toBe(true);
    expect(current.groups).toEqual(grouped.groups);
    expect(travelGraph('groups-test', current, 'undo', 1, (g) => { current = g; return true; })).toBe(true);
    expect(current.groups).toBeUndefined();

    expect(travelGraph('groups-test', current, 'redo', 4, (g) => { current = g; return true; })).toBe(true);
    expect(current.groups).toEqual([]);
  });
});
