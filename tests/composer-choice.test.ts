import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { composerChosen, ensureComposerModels, pickComposerModel } from '../src/engine/catalog';
import { buildContext } from '../src/engine/agent/context';
import { useStore } from '../src/store/store';
import type { ModelSummary } from '../src/engine/types';

const video = (ref: string): ModelSummary => ({ ref, provider: 'atlas', id: ref.split('::')[1], name: ref.split('::')[1], kind: 'video', acceptsText: true, tags: [] });
const KLING = 'atlas::kwaivgi/kling-v3.0-pro/text-to-video';
const H3DEV = 'atlas::minimax/h3-developer/text-to-video';

beforeEach(() => {
  const st = useStore.getState();
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'k' } },
    catalog: { ...st.catalog, models: { [KLING]: video(KLING), [H3DEV]: video(H3DEV) }, status: { ...st.catalog.status, atlas: 'ready' } },
    composer: { ...st.composer, userPicked: {}, video: { ...st.composer.video, modelRef: KLING } },
  });
});

const videoRef = () => useStore.getState().composer.video.modelRef;
const ctx = () => buildContext(useStore.getState().sessions[useStore.getState().activeSessionId], { workspace: 'chat', style: 'auto', round: 0, maxRounds: 2, attachments: [] });

describe('the composer model only rules when the user picked it (C2)', () => {
  it('an old default (Kling) is replaced by the current preference, and the agent is not told about it', () => {
    expect(composerChosen('video')).toBe(false);
    expect(ctx()).toMatch(/video model: none picked by the user/);
    ensureComposerModels();
    expect(videoRef()).toBe(H3DEV);
  });

  it('a model picked in the selector stays, and the agent is told it is the user’s choice', async () => {
    await pickComposerModel('video', KLING);
    expect(composerChosen('video')).toBe(true);
    ensureComposerModels();
    expect(videoRef()).toBe(KLING);
    expect(ctx()).toMatch(/video model \(picked by the user\): atlas::kwaivgi\/kling-v3\.0-pro/);
  });
});
