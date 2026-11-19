import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordGraph, travelGraph, noteDropped } from '../src/engine/flow/history';
import { NO_RESULT } from '../src/engine/flow/graph';
import type { Graph } from '../src/engine/types';

const world = (title: string, index: number, pick = 1): Graph => ({
  nodes: [
    { id: 'im', position: { x: 0, y: 0 }, data: { kind: 'image', title, prompt: 'x', modelRef: 'm', settings: { count: 3, advanced: {} }, generationId: 'g1', outputIndex: pick } as never },
    { id: 't', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'T', prompt: 'x', modelRef: 'm', settings: { count: 1, advanced: {} } } as never },
  ],
  edges: [{ id: 'e', source: 'im', target: 't', sourceHandle: `r${index}`, targetHandle: 'ref', kind: 'data', outputIndex: index } as never],
});
afterEach(() => vi.useRealTimers());

describe('undoing an edit after results were deleted', () => {
  it('an old cable index follows its image (or ends as NO_RESULT), never lands on the neighbour', () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    recordGraph('s', world('Before', 2, 2), world('After', 2, 2)); // the cable delivered result 2
    vi.setSystemTime(2000);
    noteDropped('g1', [-1, 0, 1], 2); // result 0 deleted: result 2 is now 1
    let restored = world('After', 1, 1);
    travelGraph('s', restored, 'undo', 1, (g) => { restored = g; return true; });
    expect(restored.edges[0].outputIndex).toBe(1); // the same image, at its new index (not 2: out of range, not the old 2's neighbour)
    expect((restored.nodes[0].data as { outputIndex: number }).outputIndex).toBe(1);
  });

  it('a cable whose image was deleted comes back with no result', () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    recordGraph('s2', world('Before', 0, 0), world('After', 0, 0));
    vi.setSystemTime(2000);
    noteDropped('g1', [-1, 0, 1], 2);
    let restored = world('After', 0, 0);
    travelGraph('s2', restored, 'undo', 1, (g) => { restored = g; return true; });
    expect(restored.edges[0].outputIndex).toBe(NO_RESULT);
  });
});
