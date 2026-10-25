import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { confirmApproved } from '../src/engine/agent/inherit';
import { useStore } from '../src/store/store';
import type { ModelSummary, PlanStep } from '../src/engine/types';

/* Auto: approving a plan confirms what it runs (sandbox session 2026-10-25). */
const TEXT = 'atlas::google/nano-banana-2/text-to-image';
const EDIT = 'atlas::google/nano-banana-2/edit';
const OTHER = 'atlas::bytedance/seedream-v5.0-flash/text-to-image';
const before = useStore.getState();
const sid = () => before.activeSessionId;
const confirmed = () => useStore.getState().sessions[sid()].agent.settings;
afterEach(() => useStore.setState(before));

function setup() {
  const model = (ref: string, name: string, acceptsImage: boolean) => ({ ref, id: ref.split('::')[1], provider: 'atlas', kind: 'image', name, acceptsText: true, acceptsImage, tags: [] }) as unknown as ModelSummary;
  const s = useStore.getState();
  useStore.setState({
    catalog: { ...s.catalog, models: { ...s.catalog.models, [TEXT]: model(TEXT, 'Nano Banana 2', false), [EDIT]: model(EDIT, 'Nano Banana 2', true), [OTHER]: model(OTHER, 'Seedream 5.0 Flash', false) } },
    sessions: { ...s.sessions, [sid()]: { ...s.sessions[sid()], agent: { ...s.sessions[sid()].agent, settings: { image: { modelRef: OTHER, needsImage: false, count: 1, aspect: '1:1' } } } } },
  });
}
const img = (id: string, modelRef: string, over: Record<string, unknown> = {}) => ({ id, kind: 'image', title: id, prompt: id, modelRef, refs: [], settings: { aspect: '16:9', count: 2, resolution: '2K', advanced: {} }, ...over }) as unknown as PlanStep;

describe('approving an Auto plan confirms what it runs', () => {
  it('confirms the model and values of the first step of each kind', () => {
    setup();
    confirmApproved(sid(), [img('s1', TEXT), img('s2', TEXT, { settings: { aspect: '9:16', count: 1, advanced: {} } })]);
    expect(confirmed()?.image).toMatchObject({ modelRef: TEXT, aspect: '16:9', count: 2, resolution: '2K', needsImage: false });
  });

  it('confirms the line, not the edit variant a step with images runs on', () => {
    setup();
    confirmApproved(sid(), [img('s1', EDIT, { refs: ['asset:a'] })]);
    expect(confirmed()?.image).toMatchObject({ modelRef: TEXT, needsImage: true });
  });

  it('keeps the confirmed choice when the plan compares two models of a kind', () => {
    setup();
    confirmApproved(sid(), [img('s1', TEXT), img('s2', OTHER)]);
    expect(confirmed()?.image?.modelRef).toBe(OTHER);
  });

  it('an operation step sets nothing', () => {
    setup();
    confirmApproved(sid(), [{ id: 'o1', kind: 'op', op: 'angle', title: 'o', from: 'asset:a' } as unknown as PlanStep]);
    expect(confirmed()?.image?.modelRef).toBe(OTHER);
  });
});
