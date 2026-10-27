import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { rememberSessionModel, setSessionModelAsDefault } from '../src/engine/agent/sessionModel';
import { pickComposerModel } from '../src/engine/catalog';
import { useStore } from '../src/store/store';
import type { SettingsChoice } from '../src/engine/types';

const before = useStore.getState();
const sid = before.activeSessionId;
const choice: SettingsChoice = { modelRef: 'atlas::example/image', aspect: '4:5', resolution: '2K', count: 2, needsImage: false };
afterEach(() => useStore.setState(before));

describe('session model choices and composer defaults', () => {
  it('remembers a session choice without changing defaults when the setting is off', () => {
    rememberSessionModel(sid, 'image', choice);
    expect(useStore.getState().sessions[sid].agent.settings?.image).toEqual(choice);
    expect(useStore.getState().composer).toEqual(before.composer);
  });

  it('copies an explicitly chosen model into composer defaults when enabled', () => {
    useStore.setState({ settings: { ...before.settings, agent: { ...before.settings.agent, updateComposerDefaults: true } } as typeof before.settings });
    rememberSessionModel(sid, 'image', choice, true);
    expect(useStore.getState().sessions[sid].agent.settings?.image).toEqual(choice);
    expect(useStore.getState().composer.image.modelRef).toBe(choice.modelRef);
    expect(useStore.getState().composer.userPicked?.image).toBe(true);
  });

  it('sets the current session choice as a composer default on request', async () => {
    rememberSessionModel(sid, 'image', choice);
    await setSessionModelAsDefault(sid, 'image');
    expect(useStore.getState().composer.image.modelRef).toBe(choice.modelRef);
    expect(useStore.getState().composer.userPicked?.image).toBe(true);
  });

  it('a picked composer model is a session choice; an automatic variant switch is not', async () => {
    rememberSessionModel(sid, 'image', choice);
    await pickComposerModel('image', 'atlas::other/image', false);
    expect(useStore.getState().sessions[sid].agent.settings?.image?.modelRef).toBe(choice.modelRef);
    await pickComposerModel('image', 'atlas::other/image');
    expect(useStore.getState().sessions[sid].agent.settings?.image?.modelRef).toBe('atlas::other/image');
  });
});
