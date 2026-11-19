import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import '../src/engine/nodecore/migrate';
import { migrateAgents } from '../src/engine/nodecore/migrate';
import { MAIN_THREAD, threadOf } from '../src/engine/agent/threads';
import { createSession, useStore } from '../src/store/store';
import type { AgentState, Session } from '../src/engine/types';

const agent = (history: string[], extra: Partial<AgentState> = {}): AgentState => ({ history: history.map((content) => ({ role: 'user' as const, content })), questionRound: 0, notes: [], busy: true, phase: 'working', ...extra });
// Test data only: sessions as the app saved them before threads (a single `agent`).
const saved = (extra: Record<string, unknown>): Session => ({ ...createSession('old'), agents: undefined, ...extra } as unknown as Session);

describe('saved sessions load with one thread per agent', () => {
  it('a session with only `agent` keeps it as its main thread, idle', () => {
    const s = migrateAgents(saved({ agent: agent(['hello']) }));
    expect(s.agents[MAIN_THREAD].history).toHaveLength(1);
    expect(s.agents[MAIN_THREAD]).toMatchObject({ busy: false, phase: undefined });
    expect('agent' in s).toBe(false);
  });
  it('`agent` is the thread of the agent that was on screen; the others keep theirs', () => {
    const s = migrateAgents(saved({ agent: agent(['B talk']), agentLane: 'agentB', agents: { agentA: agent(['A talk']), agentB: agent(['stale B']) } }));
    expect(s.agents.agentA.history[0].content).toBe('A talk');
    expect(s.agents.agentB.history[0].content).toBe('B talk');
    expect(threadOf(s, undefined)?.history[0].content).toBe('B talk');
  });
  it('the oldest shape (`agentLanes`) folds in too', () => {
    const s = migrateAgents(saved({ agent: agent(['now']), agentLane: 'agentA', agentLanes: { agentB: agent(['parked B']) } }));
    expect(Object.keys(s.agents).sort()).toEqual(['agentA', 'agentB']);
    expect('agentLanes' in s).toBe(false);
  });
  it('is idempotent, and loading through the store applies it', () => {
    const once = migrateAgents(saved({ agent: agent(['x']) }));
    expect(migrateAgents(once)).toEqual(once);
    const merged = useStore.persist.getOptions().merge!({ sessions: { s1: saved({ id: 's1', agent: agent(['via store']) }) } }, useStore.getState()) as ReturnType<typeof useStore.getState>;
    expect(merged.sessions.s1.agents[MAIN_THREAD].history[0].content).toBe('via store');
  });
});
