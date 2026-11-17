import { describe, expect, it } from 'vitest';
import { connectedState } from '../src/components/shell/connectedState';
import { ordinaryGraph } from '../src/engine/nodes/omni';
import type { Graph } from '../src/engine/types';

describe('adversarial visibility and connection state', () => {
  it('a failed local server clears Connected even when providers remain configured', () => {
    expect(connectedState(4, 'disk')).toMatchObject({ on: false });
  });
  it('ordinary Nodes strips system nodes even when the source graph contains them', () => {
    const graph = { nodes: [
      { id: 'system-chat', position: { x: 0, y: 0 }, data: { kind: 'ref', type: 'chat', ref: 's', title: 'Chat' } },
      { id: 'ordinary', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'Text', text: 'keep' } },
    ], edges: [], groups: [] } as unknown as Graph;
    const visible = ordinaryGraph(graph);
    expect(visible.nodes.map(n => n.id)).toEqual(['ordinary']);
  });
});
