// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { installHomeAutoClose, installHomeKeyGuard } from '../src/components/shell/homeGuard';
import { createSession, newSession, setUi, useStore } from '../src/store/store';

installHomeKeyGuard();
let stopAutoClose = installHomeAutoClose();
// The guard rebases on the first hydrated state and then closes what a session change hides.
useStore.setState({ hydrated: true });

const press = (target: EventTarget) => {
  const seen = vi.fn();
  window.addEventListener('keydown', seen);
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  window.removeEventListener('keydown', seen);
  return seen.mock.calls.length;
};

describe('Home over a mounted workspace', () => {
  it('keeps workspace shortcuts (e.g. Ctrl+Z) from reaching the hidden workspace', () => {
    setUi({ home: true });
    expect(press(document.body)).toBe(0);
    setUi({ home: false });
    expect(press(document.body)).toBe(1);
  });

  it('lets keys typed inside Home reach Home itself, but not the window listeners of the hidden canvas', () => {
    const home = document.createElement('div');
    home.className = 'home';
    const input = document.createElement('input');
    const own = vi.fn();
    input.addEventListener('keydown', own);
    home.append(input);
    document.body.append(home);
    setUi({ home: true });
    expect(press(input)).toBe(0);
    expect(own).toHaveBeenCalledTimes(1);
    setUi({ home: false });
    expect(press(input)).toBe(1);
    home.remove();
  });

  it('keeps dialogs and popovers, and the trace shortcut, on the window', () => {
    const home = document.createElement('div');
    home.className = 'home';
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const button = document.createElement('button');
    home.append(button);
    document.body.append(home, dialog); // dialogs and popovers are portaled outside Home
    setUi({ home: true });
    expect(press(dialog)).toBe(1);
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    button.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', ctrlKey: true, altKey: true, bubbles: true }));
    window.removeEventListener('keydown', seen);
    expect(seen).toHaveBeenCalledTimes(1);
    setUi({ home: false });
    home.remove();
    dialog.remove();
  });

  it('cuts document listeners too (ReactFlow deletes nodes on document) and Home\'s embedded Library, but Escape still closes a side panel', () => {
    const home = document.createElement('div');
    home.className = 'home';
    const embed = document.createElement('div');
    embed.className = 'side-panel home-embed';
    const button = document.createElement('button');
    embed.append(button);
    home.append(embed);
    document.body.append(home);
    const onDoc = vi.fn();
    document.addEventListener('keydown', onDoc);
    setUi({ home: true });
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(onDoc).not.toHaveBeenCalled();
    expect(press(button)).toBe(0);
    setUi({ panel: 'gallery' });
    const esc = vi.fn();
    window.addEventListener('keydown', esc);
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.removeEventListener('keydown', esc);
    expect(esc).toHaveBeenCalledTimes(1);
    setUi({ home: false, panel: null });
    document.removeEventListener('keydown', onDoc);
    home.remove();
  });

  it('closes when the session changes (new session, top selector)', () => {
    setUi({ home: true });
    newSession();
    expect(useStore.getState().ui.home).toBe(false);
  });

  it('after restoring a Space, a later session change still closes it', () => {
    setUi({ home: false, space: 'create' });
    newSession();
    expect(useStore.getState().ui.space).toBeUndefined();
  });

  it('closes when something asks for the composer (Use as reference)', () => {
    setUi({ home: true });
    setUi((u) => ({ focusComposer: u.focusComposer + 1 }));
    expect(useStore.getState().ui.home).toBe(false);
  });

  it('stays open for unrelated UI changes', () => {
    setUi({ home: true });
    setUi({ panel: 'sessions' });
    expect(useStore.getState().ui.home).toBe(true);
    setUi({ home: false, panel: null });
  });
});

describe('Hydration while Home or a Space is restored', () => {
  const start = useStore.getState();
  const stored = [createSession('Stored A'), createSession('Stored B')];
  useStore.setState({ sessions: { ...start.sessions, ...Object.fromEntries(stored.map((s) => [s.id, s])) } });

  // The subscription keeps its own reference; each case needs one that saw the not-yet-hydrated state.
  const reinstallAt = (patch: Partial<ReturnType<typeof useStore.getState>>) => {
    useStore.setState(patch);
    stopAutoClose();
    stopAutoClose = installHomeAutoClose();
  };

  afterEach(() => {
    useStore.setState({ hydrated: true, activeSessionId: start.activeSessionId, ui: { ...useStore.getState().ui, home: false, space: undefined } });
    stopAutoClose();
    stopAutoClose = installHomeAutoClose();
  });

  it('keeps a restored Space when the stored session replaces the active one before hydrated flips', () => {
    reinstallAt({ hydrated: false, ui: { ...useStore.getState().ui, home: false, space: 'create' } });
    useStore.setState({ activeSessionId: stored[0].id }); // what rehydrate's merge writes first
    useStore.setState({ hydrated: true });
    expect(useStore.getState().ui.space).toBe('create');
  });

  it('keeps restored Home when hydration arrives in the same update as another active session', () => {
    reinstallAt({ hydrated: false, ui: { ...useStore.getState().ui, home: true, space: undefined } });
    useStore.setState({ hydrated: true, activeSessionId: stored[1].id });
    expect(useStore.getState().ui.home).toBe(true);
  });
});
