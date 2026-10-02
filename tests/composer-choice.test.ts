import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { composerChosen, ensureComposerModels, pickComposerModel } from '../src/engine/catalog';
import { buildContext } from '../src/engine/agent/context';
import { useStore } from '../src/store/store';
import type { ModelSummary } from '../src/engine/types';

const video = (ref: string): ModelSummary => ({ ref, provider: 'atlas', id: ref.split('::')[1], name: ref.split('::')[1], kind: 'video', acceptsText: true, acceptsImage: false, tags: [] });
const KLING = 'atlas::kwaivgi/kling-v3.0-pro/text-to-video';
const H3DEV = 'atlas::minimax/h3-developer/text-to-video';
const TURBO = 'atlas::minimax/h3-max-turbo/text-to-video';
const WAN = 'atlas::alibaba/wan-3.0/text-to-video';

beforeEach(() => {
  const st = useStore.getState();
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'k' } },
    catalog: { ...st.catalog, models: { [KLING]: video(KLING), [H3DEV]: video(H3DEV), [TURBO]: video(TURBO), [WAN]: video(WAN) }, status: { ...st.catalog.status, atlas: 'ready' } },
    composer: { ...st.composer, userPicked: {}, videoRoutes: undefined, video: { ...st.composer.video, modelRef: KLING } },
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

describe("the context names each purpose's default model and its guide (C4)", () => {
  it('draft, normal and long resolve with the connected catalog, with the guide to load once', () => {
    const c = ctx();
    expect(c).toMatch(/draft → MiniMax H3 Max Turbo, normal → MiniMax H3 Developer, long → Wan 3\.0/);
    expect(c).toMatch(/load its guide once: model:minimax \(draft, normal\), model:wan \(long\)/);
  });

  it("without the table's providers it says so instead of naming a model", () => {
    const st = useStore.getState();
    useStore.setState({ catalog: { ...st.catalog, models: { [KLING]: video(KLING) } } });
    expect(ctx()).toMatch(/no provider of the table \(Atlas, NanoGPT\) is connected/);
  });

  it('adds route choices to context only after the user overrides one', () => {
    expect(ctx()).not.toMatch(/video route models picked by the user/);
    const st = useStore.getState();
    useStore.setState({ composer: { ...st.composer, videoRoutes: { image: 'atlas::minimax/h3-developer/image-to-video' } } });
    expect(ctx()).toMatch(/video route models picked by the user: image → atlas::minimax\/h3-developer\/image-to-video/);
  });
});

describe('a step with an input image keeps the composer image model line', () => {
  it('Nano Banana (v1) picked by the user edits with Nano Banana edit, not the app preference', async () => {
    const { defaultModelFor } = await import('../src/engine/catalog');
    const img = (ref: string, acceptsImage: boolean): ModelSummary => ({ ref, provider: 'atlas', id: ref.split('::')[1], name: ref.split('::')[1], kind: 'image', acceptsText: true, acceptsImage, tags: [] });
    const T2I = 'atlas::google/nano-banana/text-to-image-developer';
    const EDIT = 'atlas::google/nano-banana/edit-developer';
    const NB2 = 'atlas::google/nano-banana-2/edit-developer';
    const st = useStore.getState();
    useStore.setState({
      catalog: { ...st.catalog, models: { [T2I]: img(T2I, false), [EDIT]: img(EDIT, true), [NB2]: img(NB2, true) } },
      composer: { ...st.composer, userPicked: { image: true }, image: { ...st.composer.image, modelRef: T2I } },
    });
    expect(defaultModelFor('image', true)).toBe(EDIT);
  });
});
