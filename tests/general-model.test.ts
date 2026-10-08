import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOMATION_POLICY, costAskMessage, LOW_COST_USD, needsConfirmation, planRequiresSettings } from '../src/engine/procedure';
import type { MediaKind, SettingsChoice, Workspace } from '../src/engine/types';

vi.hoisted(() => Object.assign(globalThis, {
  window: { setTimeout, clearTimeout, addEventListener: () => undefined },
  document: { addEventListener: () => undefined, visibilityState: 'visible' },
}));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined, putAssetBlob: async () => undefined,
}));

const settingsWith = (kinds: MediaKind[]): Partial<Record<MediaKind, SettingsChoice>> =>
  Object.fromEntries(kinds.map(k => [k, { modelRef: 'x', count: 1, duration: undefined, needsImage: false }])) as Partial<Record<MediaKind, SettingsChoice>>;

const base = { workspace: 'chat' as Workspace, kinds: ['image'] as MediaKind[], settings: settingsWith(['image']), userChoseModel: false, estimatedCost: 0.05, hasMultipleCandidates: false };

/* ── Automation policy (§11): needsConfirmation decides what the app does ── */

describe('needsConfirmation — automation policy', () => {
  it('asks when a kind was never confirmed in this session', () => {
    expect(needsConfirmation({ ...base, settings: undefined })).toBe('ask');
  });

  it('asks when one kind of a mixed plan was never confirmed', () => {
    expect(needsConfirmation({ ...base, kinds: ['image', 'video'], settings: settingsWith(['image']) })).toBe('ask');
  });

  it('asks when the cost is unknown, even for a confirmed kind', () => {
    expect(needsConfirmation({ ...base, estimatedCost: null })).toBe('ask');
  });

  it('asks when the cost is above the low-cost limit', () => {
    expect(needsConfirmation({ ...base, estimatedCost: LOW_COST_USD + 0.01 })).toBe('ask');
    expect(needsConfirmation({ ...base, kinds: ['video'], settings: settingsWith(['video']), estimatedCost: 2 })).toBe('ask');
  });

  it('keeps the limit inclusive: a cost of exactly the limit is still low', () => {
    expect(needsConfirmation({ ...base, estimatedCost: LOW_COST_USD })).toBe('automate');
  });

  it('exposes a low-cost plan when the user named a model', () => {
    expect(needsConfirmation({ ...base, userChoseModel: true })).toBe('expose');
  });

  it('exposes a low-cost video without asking', () => {
    expect(needsConfirmation({ ...base, kinds: ['video'], settings: settingsWith(['video']), estimatedCost: 0.2 })).toBe('expose');
  });

  it('exposes several candidates of a low-cost plan without asking', () => {
    expect(needsConfirmation({ ...base, hasMultipleCandidates: true })).toBe('expose');
  });

  it('automates a low-cost single image with confirmed settings and no named model', () => {
    expect(needsConfirmation({ ...base, estimatedCost: 0.1 })).toBe('automate');
  });

  it('automates on the node canvas always: nodes own their settings', () => {
    expect(needsConfirmation({ ...base, workspace: 'node', settings: undefined, estimatedCost: null })).toBe('automate');
  });
});

describe('costAskMessage and policy text match the decision', () => {
  it('explains an unknown cost and a cost above the limit', () => {
    expect(costAskMessage(['image'], null)).toContain('cannot be predicted');
    expect(costAskMessage(['image'], 2)).toContain(`above $${LOW_COST_USD.toFixed(2)}`);
    expect(costAskMessage(['image'], 2)).toContain('confirm_settings');
  });

  it('AUTOMATION_POLICY states the same limit and the same expose and ask cases', () => {
    expect(AUTOMATION_POLICY).toContain(`$${LOW_COST_USD.toFixed(2)}`);
    expect(AUTOMATION_POLICY).toContain('never confirmed');
    expect(AUTOMATION_POLICY).not.toContain('pre-filled');
  });
});

/* ── Gate before normalization: a kind never confirmed still blocks ───────── */

describe('planRequiresSettings — propose_plan gate before normalization', () => {
  it('blocks when an image kind is missing', () => {
    expect(planRequiresSettings('chat', ['image'], undefined)).toContain('confirm_settings first');
  });
  it('blocks when a video kind is missing', () => {
    expect(planRequiresSettings('chat', ['video'], undefined)).toContain('video');
  });
  it('passes on node canvas', () => {
    expect(planRequiresSettings('node', ['image'], undefined)).toBeNull();
  });
  it('passes when kind already confirmed (cost is checked after normalization)', () => {
    expect(planRequiresSettings('chat', ['image'], settingsWith(['image']))).toBeNull();
  });
});

describe('system prompt describes the automation policy', () => {
  it('includes the preparation rule and the single-image reuse case', async () => {
    const { SYSTEM_PROMPT } = await import('../src/engine/agent/context');
    expect(SYSTEM_PROMPT).toContain('Prepare only what is necessary');
    expect(SYSTEM_PROMPT).toContain('low-cost single image');
  });
  it('tells the agent the limit and when the app blocks', async () => {
    const { SYSTEM_PROMPT } = await import('../src/engine/agent/context');
    expect(SYSTEM_PROMPT).toContain('reuses those settings without a new card');
    expect(SYSTEM_PROMPT).toContain('above 0.50 USD');
  });
});

/* ── Operation vs attempt (operationId) and the retry that relinks owners ── */

describe('operationId and retry (Operation vs Attempt)', () => {
  beforeEach(async () => {
    const { useStore } = await import('../src/store/store');
    const st = useStore.getState();
    useStore.setState({
      catalog: { ...st.catalog, models: { 'local::sketch': { id: 'local::sketch', name: 'Sketch', kind: 'image' as const, provider: 'local' as const, ref: 'local::sketch', inputSlots: { accepts: ['image'] } } } as never },
    });
    // Any provider call fails quickly: these tests check the bookkeeping, not the output.
    vi.stubGlobal('fetch', async () => { throw new Error('offline in test'); });
  });

  const newImage = async (operationId?: string) => {
    const { createGeneration } = await import('../src/engine/jobs');
    const { useStore } = await import('../src/store/store');
    return createGeneration({
      sessionId: useStore.getState().activeSessionId, kind: 'image', prompt: 'test', modelRef: 'local::sketch',
      settings: { count: 1, advanced: {} }, origin: 'composer', operationId,
    });
  };

  it('createGeneration stores operationId from spec', async () => {
    expect((await newImage('op_test_123')).operationId).toBe('op_test_123');
  });

  it('createGeneration leaves operationId undefined when not provided', async () => {
    expect((await newImage()).operationId).toBeUndefined();
  });

  it('a retry is a new attempt of the same operation; the failed record stays as history', async () => {
    const { retryGeneration } = await import('../src/engine/jobs');
    const { useStore, patchGeneration } = await import('../src/store/store');
    const failed = await newImage('op_keep');
    patchGeneration(failed.id, { status: 'error', error: 'boom' });
    retryGeneration(failed.id).catch(() => undefined);
    const attempts = Object.values(useStore.getState().generations).filter(g => g.operationId === 'op_keep');
    expect(attempts).toHaveLength(2);
    expect(attempts.map(g => g.id)).toContain(failed.id);
    expect(useStore.getState().generations[failed.id].status).toBe('error');
  });

  it('a retry relinks the node, the chat card and the plan step that showed the failed attempt', async () => {
    const { retryGeneration } = await import('../src/engine/jobs');
    const { useStore, patchGeneration, appendFeed } = await import('../src/store/store');
    const sid = useStore.getState().activeSessionId;
    const failed = await newImage();
    patchGeneration(failed.id, { status: 'error', error: 'boom' });
    useStore.setState((s) => ({
      sessions: {
        ...s.sessions,
        [sid]: {
          ...s.sessions[sid],
          graph: { nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'image', generationId: failed.id } }], edges: [] } as never,
        },
      },
    }));
    appendFeed(sid, { id: 'card1', type: 'generation', generationId: failed.id, createdAt: 1 } as never);
    appendFeed(sid, { id: 'plan1', type: 'plan', stepGenerations: { s1: failed.id }, createdAt: 1 } as never);

    retryGeneration(failed.id).catch(() => undefined);

    const s = useStore.getState().sessions[sid];
    const next = Object.values(useStore.getState().generations).find(g => g.operationId === failed.id)!;
    expect(next.id).not.toBe(failed.id);
    expect((s.graph.nodes[0].data as { generationId: string }).generationId).toBe(next.id);
    expect((s.feed.find(f => f.id === 'card1') as { generationId: string }).generationId).toBe(next.id);
    expect((s.feed.find(f => f.id === 'plan1') as { stepGenerations: Record<string, string> }).stepGenerations.s1).toBe(next.id);
    expect(useStore.getState().generations[failed.id].status).toBe('error');
  });
});
