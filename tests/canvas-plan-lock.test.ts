import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
const seen = vi.hoisted(() => ({ locked: [] as boolean[] }));
const execute = vi.hoisted(() => vi.fn());
vi.mock('../src/engine/executor', async (original) => ({ ...(await original<typeof import('../src/engine/executor')>()), executeSteps: execute }));
import { useStore } from '../src/store/store';
import { approvePlan, presentNodeRun } from '../src/engine/agent/runtime';
import { lockNodes, lockedNodes } from '../src/engine/flow/locks';
import type { Graph, PlanFeedItem, PlanStep } from '../src/engine/types';
import { agentsWith } from './helpers/threads';

let sid: string;
const step: PlanStep = { id: 's1', kind: 'image', title: 'Image', prompt: 'x', modelRef: 'local::studio-image', settings: { count: 1, advanced: {} }, refs: [] };
const card = (): PlanFeedItem => ({ id: 'fd_plan', createdAt: 1, workspace: 'node', type: 'plan', style: 'auto', plan: { id: 'pln', title: 'Canvas plan', summary: '', workspace: 'node', style: '', steps: [step], subjects: [], adjustments: [] }, status: 'awaiting', stepStates: {}, stepGenerations: {}, estimate: { usd: 0.01, approximate: false } });

beforeEach(() => {
  const st = useStore.getState(); sid = st.activeSessionId;
  const graph = { nodes: [{ id: 'pln_s1', planId: 'pln', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'Image', prompt: 'x', modelRef: 'local::studio-image', settings: { count: 1, advanced: {} } } }], edges: [] } as unknown as Graph;
  useStore.setState({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph, feed: [card()], agents: agentsWith(st.sessions[sid], { pending: undefined, busy: false }) } } });
  seen.locked = []; execute.mockReset();
  execute.mockImplementation(async () => { seen.locked.push(lockedNodes(sid).has('pln_s1')); return { outputs: new Map(), failed: [], skipped: [], waiting: [] }; });
});

describe('a Nodes plan runs under the node lock', () => {
  it('its nodes are locked while it sends, so a Run on the same node cannot pay for the same image twice', async () => {
    const made = await presentNodeRun(sid, ['pln_s1'], null, undefined, 'main');
    await approvePlan(sid, made.itemId!);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(seen.locked).toEqual([true]);
    expect(lockedNodes(sid).has('pln_s1')).toBe(false); // and let go after
  });

  it('does not send at all when its nodes are already running elsewhere', async () => {
    const made = await presentNodeRun(sid, ['pln_s1'], null, undefined, 'main');
    const release = lockNodes(sid, ['pln_s1']);
    await approvePlan(sid, made.itemId!);
    release();
    expect(execute).not.toHaveBeenCalled();
    const item = useStore.getState().sessions[sid].feed.find((f) => f.id === made.itemId) as PlanFeedItem;
    expect(item.status).not.toBe('done'); // nothing was sent: it waits for a new approval
  });
});

describe('a Nodes plan has one door to the provider', () => {
  it('a Nodes plan card without a prepared node run is not executed (the window before prepare finishes)', async () => {
    const st = useStore.getState();
    useStore.setState({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [card()] } } });
    await approvePlan(sid, 'fd_plan');
    expect(execute).not.toHaveBeenCalled();
  });

  it('a plan generation whose card is gone from the feed is refused at the send, not sent', async () => {
    const { checkStepAuthorization } = await import('../src/engine/priceAuthorization');
    const st = useStore.getState();
    useStore.setState({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [] } } });
    const g = { id: 'g', sessionId: sid, planId: 'pln', stepId: 'pln_s1', inputs: { refs: [] } } as never;
    const proposed = { modelRef: 'local::studio-image', parameters: { count: 1, advanced: {} }, estimate: { usd: 0.01 } } as never;
    expect(() => checkStepAuthorization(g, proposed)).toThrow(/no longer in the chat/);
  });

  it('a plan step nobody authorized is refused at the send, not sent', async () => {
    const { checkStepAuthorization } = await import('../src/engine/priceAuthorization');
    const st = useStore.getState();
    useStore.setState({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [{ ...card(), status: 'running' }] } } });
    const g = { id: 'g', sessionId: sid, planId: 'pln', stepId: 'pln_s1', inputs: { refs: [] } } as never;
    const proposed = { modelRef: 'local::studio-image', parameters: { count: 1, advanced: {} }, estimate: { usd: 0.01 } } as never;
    expect(() => checkStepAuthorization(g, proposed)).toThrow(/no approved price/);
  });
});
