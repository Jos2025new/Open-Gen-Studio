import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
const seen = vi.hoisted(() => ({ locked: [] as boolean[] }));
const execute = vi.hoisted(() => vi.fn());
vi.mock('../src/engine/executor', async (original) => ({ ...(await original<typeof import('../src/engine/executor')>()), executeSteps: execute }));
import { useStore } from '../src/store/store';
import { approvePlan } from '../src/engine/agent/runtime';
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

describe('a canvas plan runs under the node lock', () => {
  it('its nodes are locked while it sends, so a Run on the same node cannot pay for the same image twice', async () => {
    await approvePlan(sid, 'fd_plan');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(seen.locked).toEqual([true]);
    expect(lockedNodes(sid).has('pln_s1')).toBe(false); // and let go after
  });

  it('does not send at all when its nodes are already running elsewhere', async () => {
    const release = lockNodes(sid, ['pln_s1']);
    await approvePlan(sid, 'fd_plan');
    release();
    expect(execute).not.toHaveBeenCalled();
    const item = useStore.getState().sessions[sid].feed[0] as PlanFeedItem;
    expect(item.status).toBe('error');
    expect(item.error).toMatch(/already running/);
  });
});
