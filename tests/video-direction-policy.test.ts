import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { buildContext, SYSTEM_PROMPT } from '../src/engine/agent/context';
import { VIDEO_DIRECTION_POLICY, VIDEO_REALISM_POLICY } from '../src/engine/procedure';
import { useStore } from '../src/store/store';
import type { AgentStyle } from '../src/engine/types';

const initial = useStore.getState();
afterEach(() => useStore.setState(initial));

describe('realism registers in the agent prompt', () => {
  it('states the cues, the balanced default and the video realism policy', () => {
    expect(SYSTEM_PROMPT).toContain(VIDEO_REALISM_POLICY);
    expect(VIDEO_REALISM_POLICY).toContain('No on-screen text');
    for (const cue of ['default "balanced"', 'iPhone', 'found footage', 'cinematográfico', 'tráiler']) expect(SYSTEM_PROMPT).toContain(cue);
  });
});

describe('shared video direction policy', () => {
  it('is part of the common agent prompt, independent of mode and cinematic selection', () => {
    expect(VIDEO_DIRECTION_POLICY).toContain('Every video, mode and domain');
    expect(SYSTEM_PROMPT).toContain(VIDEO_DIRECTION_POLICY);
    expect(VIDEO_DIRECTION_POLICY).toContain('do not default to realism');
    expect(VIDEO_DIRECTION_POLICY).toContain('requested 2D, stylised 3D or realistic logic');
    expect(VIDEO_DIRECTION_POLICY).not.toMatch(/always (use|be) photoreal/i);
  });

  it('remains available beside each mode context without a workflow or selected cinematic preset', () => {
    useStore.setState((state) => ({ composer: { ...state.composer, workflowId: '', skillId: '' } }));
    const state = useStore.getState();
    const session = state.sessions[state.activeSessionId];
    for (const style of ['auto', 'direct', 'guided'] as AgentStyle[]) {
      const context = buildContext(session, { workspace: 'chat', style, round: 0, maxRounds: 2, attachments: [] });
      expect(context).toContain(`mode: ${style}`);
      // Runtime sends SYSTEM_PROMPT for every mode; the per-request context adds mode state, not a style preset.
      expect(SYSTEM_PROMPT).toContain(VIDEO_DIRECTION_POLICY);
      expect(context).not.toContain('workflow (');
      expect(context).not.toContain('Cinematic');
    }
  });
});
