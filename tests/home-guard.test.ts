// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { installHomeAutoClose, installHomeKeyGuard } from '../src/components/shell/homeGuard';
import { newSession, setUi, useStore } from '../src/store/store';

installHomeKeyGuard();
installHomeAutoClose();

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

  it('lets keys typed inside Home through', () => {
    const home = document.createElement('div');
    home.className = 'home';
    const input = document.createElement('input');
    home.append(input);
    document.body.append(home);
    setUi({ home: true });
    expect(press(input)).toBe(1);
    setUi({ home: false });
    home.remove();
  });

  it('closes when the session changes (new session, top selector)', () => {
    setUi({ home: true });
    newSession();
    expect(useStore.getState().ui.home).toBe(false);
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
