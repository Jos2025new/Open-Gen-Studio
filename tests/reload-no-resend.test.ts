import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
const execute = vi.hoisted(() => vi.fn());
vi.mock('../src/engine/executor', async (original) => ({ ...(await original<typeof import('../src/engine/executor')>()), executeSteps: execute }));
import { useStore } from '../src/store/store';
import { approvePlan, presentNodeRun, resumePlan, settleInterruptedPlans } from '../src/engine/agent/runtime';
import { prepareAction, resetActions, runAction } from '../src/engine/nodecore/action';
import type { Graph, PlanFeedItem, PlanStep } from '../src/engine/types';
import { agentsWith } from './helpers/threads';

let sid: string;
const image = (title: string) => ({ kind: 'image' as const, title, prompt: 'x', modelRef: 'local::studio-image', settings: { count: 1, advanced: {} }, outputIndex: 0 });

/** A real reload: what is saved goes through JSON and the store's own merge; every in-memory Map of the action ledger is gone. */
function reload(): void {
  const { partialize, merge } = useStore.persist.getOptions();
  const saved = JSON.parse(JSON.stringify(partialize!(useStore.getState())));
  useStore.setState(merge!(saved, useStore.getState()) as never, true);
  resetActions();
}
const card = (id: string) => useStore.getState().sessions[sid].feed.find((f) => f.id === id) as PlanFeedItem;

beforeEach(() => {
  const st = useStore.getState(); sid = st.activeSessionId;
  const graph: Graph = { nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: image('N1') }], edges: [] };
  useStore.setState({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph, feed: [], agents: agentsWith(st.sessions[sid], { pending: undefined, busy: false }) } }, settings: { ...st.settings, agent: { ...st.settings.agent, provider: 'offline' } } });
  execute.mockReset();
});

describe('after a reload nothing already sent is sent again', () => {
  it('a node-run card that was running or attempted: approving again, a settled card and the old approval send nothing', async () => {
    execute.mockImplementation(() => new Promise(() => undefined)); // the send is in flight when the tab closes
    const made = await presentNodeRun(sid, ['n1'], null, undefined, 'main');
    void approvePlan(sid, made.itemId!);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    const stale = await prepareAction(sid, ['n1']); // an approval the old page was holding
    reload();
    settleInterruptedPlans();
    await approvePlan(sid, made.itemId!); // the card must not be approvable again
    expect(card(made.itemId!).status).not.toBe('awaiting');
    if (stale.ok) expect((await runAction(stale.snapshot, 'again')).status).toBe('stale');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('a half-failed plan resumed after reload sends nothing and keeps the finished step', async () => {
    const steps: PlanStep[] = [1, 2].map((n) => ({ id: `s${n}`, kind: 'image', title: `S${n}`, prompt: 'x', modelRef: 'local::studio-image', settings: { count: 1, advanced: {} }, refs: [] }));
    const st = useStore.getState();
    const plan: PlanFeedItem = { id: 'fd_p', createdAt: 1, workspace: 'chat', type: 'plan', style: 'auto', plan: { id: 'pln', title: 'P', summary: '', workspace: 'chat', style: '', steps, subjects: [], adjustments: [] }, status: 'partial', stepStates: { s1: 'done', s2: 'error' }, stepGenerations: { s1: 'g1', s2: 'g2' }, stepOutputs: { s1: { assetIds: ['a1'] } }, estimate: { usd: 0.02, approximate: false }, error: 's2: Failed' };
    const gen = (id: string, status: string, step: string) => ({ id, sessionId: sid, kind: 'image', prompt: 'x', modelRef: 'local::studio-image', modelName: 'm', provider: 'atlas', settings: { count: 1, advanced: {} }, inputs: { refs: [] }, origin: 'agent', status, assetIds: status === 'done' ? ['a1'] : [], createdAt: 1, estimate: { usd: 0.01, approximate: false }, stepId: step, planId: 'pln', ...(status === 'error' ? { error: 'Failed' } : {}) });
    useStore.setState({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [plan] } }, generations: { g1: gen('g1', 'done', 's1'), g2: gen('g2', 'error', 's2') } as never });
    execute.mockResolvedValue({ outputs: new Map(), failed: [], skipped: [], waiting: [] });
    reload();
    const said = await resumePlan(sid, 'fd_p', 'check'); // asks the provider again; never submits a new one
    expect(said).toMatch(/No failed step has a submitted job/); // nothing to ask, so nothing is sent
    expect(execute).not.toHaveBeenCalled();
    expect(card('fd_p').stepStates).toEqual({ s1: 'done', s2: 'error' }); // the finished step stays finished
  });

  it('a Nodes plan that was running (its node already has a sent generation): approving, resuming and settling after reload send nothing', async () => {
    const st = useStore.getState();
    const step: PlanStep = { id: 's1', kind: 'image', title: 'S1', prompt: 'x', modelRef: 'local::studio-image', settings: { count: 1, advanced: {} }, refs: [] };
    const plan: PlanFeedItem = { id: 'fd_n', createdAt: 1, workspace: 'node', type: 'plan', style: 'auto', nodeRun: { targets: ['pln_s1'], force: true, signature: 'sig' }, plan: { id: 'pln', title: 'N', summary: '', workspace: 'node', style: '', steps: [step], subjects: [], adjustments: [] }, status: 'running', stepStates: { s1: 'running' }, stepGenerations: { s1: 'g1' }, estimate: { usd: 0.01, approximate: false } };
    const graph = { nodes: [{ id: 'pln_s1', planId: 'pln', position: { x: 0, y: 0 }, data: { ...image('S1'), generationId: 'g1' } }], edges: [] } as unknown as Graph;
    const gen = { id: 'g1', sessionId: sid, kind: 'image', prompt: 'x', modelRef: 'local::studio-image', modelName: 'm', provider: 'atlas', settings: { count: 1, advanced: {} }, inputs: { refs: [] }, origin: 'agent', status: 'running', assetIds: [], remoteJob: { provider: 'atlas', id: 'job1', meta: {} }, createdAt: 1, estimate: { usd: 0.01, approximate: false }, stepId: 'pln_s1', planId: 'pln' };
    useStore.setState({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph, feed: [plan] } }, generations: { g1: gen } as never });
    reload();
    settleInterruptedPlans();
    await approvePlan(sid, 'fd_n');
    const said = await resumePlan(sid, 'fd_n', 'retry');
    expect(said).toMatch(/rerun from their nodes/);
    expect(execute).not.toHaveBeenCalled();
    expect(card('fd_n').status).not.toBe('awaiting'); // never offered for approval again
  });
});
