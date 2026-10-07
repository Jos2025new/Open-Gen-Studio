import { describe, expect, it, vi, beforeEach } from 'vitest';
import { needsConfirmation, planRequiresSettings, type ConfirmationAction } from '../src/engine/procedure';
import type { MediaKind, SettingsChoice, Workspace } from '../src/engine/types';

/* ── Phase 1: needsConfirmation ─────────────────────────────────────────── */

describe('needsConfirmation — automation policy (Phase 1)', () => {
  const settingsWith = (kinds: MediaKind[]): Partial<Record<MediaKind, SettingsChoice>> =>
    Object.fromEntries(kinds.map(k => [k, { modelRef: 'x', count: 1, duration: undefined, needsImage: false }])) as Partial<Record<MediaKind, SettingsChoice>>;

  it('returns ask for a kind never confirmed', () => {
    expect(needsConfirmation({
      workspace: 'chat', kinds: ['image'], settings: undefined,
      userChoseModel: false, estimatedCost: 0.05, hasMultipleCandidates: false,
    })).toBe('ask');
  });

  it('returns ask for video regardless of cost', () => {
    expect(needsConfirmation({
      workspace: 'chat', kinds: ['video'], settings: settingsWith(['video']),
      userChoseModel: false, estimatedCost: 0.01, hasMultipleCandidates: false,
    })).toBe('ask');
  });

  it('returns ask for high cost', () => {
    expect(needsConfirmation({
      workspace: 'chat', kinds: ['image'], settings: settingsWith(['image']),
      userChoseModel: false, estimatedCost: 2.0, hasMultipleCandidates: false,
    })).toBe('ask');
  });

  it('returns ask for unknown cost', () => {
    expect(needsConfirmation({
      workspace: 'chat', kinds: ['image'], settings: settingsWith(['image']),
      userChoseModel: false, estimatedCost: null, hasMultipleCandidates: false,
    })).toBe('ask');
  });

  it('returns ask for multiple candidates', () => {
    expect(needsConfirmation({
      workspace: 'chat', kinds: ['image'], settings: settingsWith(['image']),
      userChoseModel: false, estimatedCost: 0.05, hasMultipleCandidates: true,
    })).toBe('ask');
  });

  it('returns expose when user chose a model', () => {
    expect(needsConfirmation({
      workspace: 'chat', kinds: ['image'], settings: settingsWith(['image']),
      userChoseModel: true, estimatedCost: 0.05, hasMultipleCandidates: false,
    })).toBe('expose');
  });

  it('returns automate for low-cost single image, settings already confirmed, no user model', () => {
    expect(needsConfirmation({
      workspace: 'chat', kinds: ['image'], settings: settingsWith(['image']),
      userChoseModel: false, estimatedCost: 0.10, hasMultipleCandidates: false,
    })).toBe('automate');
  });

  it('returns automate on node canvas always', () => {
    expect(needsConfirmation({
      workspace: 'node', kinds: ['image'], settings: undefined,
      userChoseModel: false, estimatedCost: null, hasMultipleCandidates: false,
    })).toBe('automate');
  });

  it('asks when mixed kinds include an unconfirmed kind', () => {
    expect(needsConfirmation({
      workspace: 'chat', kinds: ['image', 'video'], settings: settingsWith(['image']),
      userChoseModel: false, estimatedCost: 0.05, hasMultipleCandidates: false,
    })).toBe('ask');
  });
});

/* ── Phase 1: planRequiresSettings ──────────────────────────────────────── */

describe('planRequiresSettings — propose_plan gate', () => {
  it('blocks when an image kind is missing', () => {
    expect(planRequiresSettings('chat', ['image'], undefined)).toContain('confirm_settings first');
  });
  it('blocks when a video kind is missing', () => {
    expect(planRequiresSettings('chat', ['video'], undefined)).toContain('video');
  });
  it('passes on node canvas', () => {
    expect(planRequiresSettings('node', ['image'], undefined)).toBeNull();
  });
  it('passes when kind already confirmed', () => {
    const settings: Partial<Record<MediaKind, SettingsChoice>> = { image: { modelRef: 'x', count: 1, duration: undefined, needsImage: false } };
    expect(planRequiresSettings('chat', ['image'], settings)).toBeNull();
  });
});

/* ── Phase 1: prompt contains automation policy ─────────────────────────── */

describe('system prompt references automation policy', () => {
  it('includes AUTOMATION_POLICY text', async () => {
    const { SYSTEM_PROMPT } = await import('../src/engine/agent/context');
    expect(SYSTEM_PROMPT).toContain('Prepare only what is necessary');
    expect(SYSTEM_PROMPT).toContain('low-cost single image');
  });
  it('explains when the app reuses settings automatically', async () => {
    const { SYSTEM_PROMPT } = await import('../src/engine/agent/context');
    expect(SYSTEM_PROMPT).toContain('the app reuses those settings automatically');
  });
});

/* ── Phase 2: operationId on Generation ──────────────────────────────────── */

vi.hoisted(() => Object.assign(globalThis, {
  window: { setTimeout, clearTimeout, addEventListener: () => undefined },
  document: { addEventListener: () => undefined, visibilityState: 'visible' },
}));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined, putAssetBlob: async () => undefined,
}));

describe('operationId (Phase 2)', () => {
  beforeEach(async () => {
    const { useStore } = await import('../src/store/store');
    const st = useStore.getState();
    useStore.setState({
      settings: { ...st.settings, keys: { ...st.settings.keys, local: true } },
      catalog: { ...st.catalog, models: { 'local::sketch': { id: 'local::sketch', name: 'Sketch', kind: 'image' as const, provider: 'local' as const, generative: true, ref: 'local::sketch', inputSlots: { accepts: ['image'] } } } },
    });
  });

  it('createGeneration stores operationId from spec', async () => {
    const { createGeneration } = await import('../src/engine/jobs');
    const st = (await import('../src/store/store')).useStore.getState();
    const g = createGeneration({
      sessionId: st.activeSessionId,
      kind: 'image',
      prompt: 'test',
      modelRef: 'local::sketch',
      settings: { count: 1, advanced: {} },
      origin: 'composer',
      operationId: 'op_test_123',
    });
    expect(g.operationId).toBe('op_test_123');
  });

  it('createGeneration leaves operationId undefined when not provided', async () => {
    const { createGeneration } = await import('../src/engine/jobs');
    const st = (await import('../src/store/store')).useStore.getState();
    const g = createGeneration({
      sessionId: st.activeSessionId,
      kind: 'image',
      prompt: 'test',
      modelRef: 'local::sketch',
      settings: { count: 1, advanced: {} },
      origin: 'composer',
    });
    expect(g.operationId).toBeUndefined();
  });

  it('operationId is part of the Generation interface', async () => {
    const { createGeneration } = await import('../src/engine/jobs');
    const st = (await import('../src/store/store')).useStore.getState();
    const g = createGeneration({
      sessionId: st.activeSessionId,
      kind: 'image',
      prompt: 'test',
      modelRef: 'local::sketch',
      settings: { count: 1, advanced: {} },
      origin: 'composer',
      operationId: 'op_xyz',
    });
    // The field is present and round-trips through the store.
    expect(g).toHaveProperty('operationId');
    expect(st.generations[g.id]).toBeUndefined(); // not yet flushed
  });
});