import { describe, expect, it, vi } from 'vitest';

/* What a plan keeps from which source goes to the debug log when it runs, not to the card (2026-10-25). */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
const lines = vi.hoisted(() => [] as Array<{ kind: string; data: Record<string, unknown> }>);
vi.mock('../src/lib/log', async (load) => ({ ...(await load<typeof import('../src/lib/log')>()), logEvent: (kind: string, data: Record<string, unknown>) => lines.push({ kind, data }) }));
// Nothing runs: the line is written before the steps start.
vi.mock('../src/engine/executor', async (load) => ({ ...(await load<typeof import('../src/engine/executor')>()), executeSteps: () => new Promise(() => undefined) }));

import { approvePlan } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';
import type { FeedItem } from '../src/engine/types';

describe('continuity in the debug log', () => {
  it('a running plan logs each group and the check', async () => {
    const sid = useStore.getState().activeSessionId;
    const step = (id: string) => ({ id, kind: 'image', title: id, prompt: id, modelRef: 'local::studio-image', refs: ['s1'], settings: { count: 1, advanced: {} } });
    const plan = { id: 'pc', title: 'T', summary: '', workspace: 'chat', adjustments: [], continuity: [{ preserve: 'the boy', source: 's1', steps: ['s2'] }], steps: [{ ...step('s1'), refs: [] }, step('s2')] };
    const item = { id: 'pl', createdAt: 0, workspace: 'chat', type: 'plan', style: 'guided', status: 'awaiting', stepStates: {}, stepGenerations: {}, estimate: { usd: 0 }, plan } as unknown as FeedItem;
    useStore.setState((s) => ({ sessions: { ...s.sessions, [sid]: { ...s.sessions[sid], feed: [item] } } }));
    void approvePlan(sid, 'pl');
    await vi.waitFor(() => expect(lines.find((l) => l.data.event === 'plan.continuity')).toBeDefined());
    expect(lines.find((l) => l.data.event === 'plan.continuity')).toMatchObject({ kind: 'agent', data: { planId: 'pc', groups: [{ keep: 'the boy', from: 's1', steps: ['s2'] }] } });
  });
});
