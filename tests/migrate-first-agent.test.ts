import { describe, expect, it } from 'vitest';
import { feedOfAgentIn, migrateAgents } from '../src/engine/agent/threads';
import { createSession } from '../src/store/store';
import type { AgentState, Session } from '../src/engine/types';

const ref = (id: string) => ({ id, position: { x: 0, y: 0 }, data: { kind: 'ref' as const, type: 'agent' as const, ref: 's', title: id } });
const state = (text: string): AgentState => ({ history: [{ role: 'user', content: text }], questionRound: 0, notes: [], busy: false });

/** Before agent instances (ddf27bcb^) `agentLane` absent meant "a session from before agent instances": its single `agent` was the first agent's. */
describe('migrating a session with no agentLane', () => {
  it('gives the single agent to the first agent of the graph, not to whoever wrote last', () => {
    const old = {
      ...createSession('old'),
      graph: { nodes: [ref('agentA'), ref('agentB')], edges: [] },
      feed: [
        { id: 'f1', createdAt: 1, workspace: 'chat', type: 'user', text: 'a', mode: 'agent', attachments: [], meta: { agentNodeId: 'agentA' } },
        { id: 'f2', createdAt: 2, workspace: 'chat', type: 'user', text: 'b', mode: 'agent', attachments: [], meta: { agentNodeId: 'agentB' } },
      ],
      agent: state('mine'), agents: undefined, agentLane: undefined,
    } as unknown as Session;
    const m = migrateAgents(old);
    expect(m.agents.agentA?.history[0].content).toBe('mine');
    expect(m.agents.agentB).toBeUndefined();
  });

  it('writes the owner on rows that name none, so deleting the first agent does not hand them to the next', () => {
    const old = { ...createSession('o'), graph: { nodes: [ref('agentA'), ref('agentB')], edges: [] }, feed: [{ id: 'f1', createdAt: 1, workspace: 'chat', type: 'user', text: 'old', mode: 'agent', attachments: [] }] } as unknown as Session;
    const m = migrateAgents(old);
    const without = { ...m, graph: { ...m.graph, nodes: m.graph.nodes.filter((n) => n.id !== 'agentA') } };
    expect(feedOfAgentIn(m, 'agentA')).toHaveLength(1);
    expect(feedOfAgentIn(without, 'agentB')).toHaveLength(0);
    expect(migrateAgents(m)).toEqual(m); // idempotent
  });
});
