// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { useStore } from '../src/store/store';
import { installDoneNotice, BATCH_MS } from '../src/lib/doneNotice';
import type { Generation } from '../src/engine/types';

const gen = (id: string, status: Generation['status']) => ({ id, status, kind: 'image', modelRef: 'm', createdAt: 0 }) as Generation;
const setGens = (...gs: Generation[]) => useStore.setState({ generations: Object.fromEntries(gs.map((g) => [g.id, g])) });
const hide = (hidden: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
};
const Notif = vi.fn();

describe('done notice', () => {
  let off: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    document.title = 'OGS';
    Notif.mockClear();
    (Notif as unknown as { permission: string }).permission = 'granted';
    vi.stubGlobal('Notification', Notif);
    useStore.setState({ settings: { ...useStore.getState().settings, notify: false } });
    setGens(gen('a', 'running'), gen('b', 'running'), gen('c', 'running'));
    off = installDoneNotice();
  });
  afterEach(() => { off(); hide(false); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('counts finishes while hidden and resets when visible', () => {
    hide(true);
    setGens(gen('a', 'done'), gen('b', 'running'), gen('c', 'running'));
    expect(document.title).toBe('(1) OGS');
    setGens(gen('a', 'done'), gen('b', 'error'), gen('c', 'running'));
    expect(document.title).toBe('(2) OGS');
    hide(false);
    expect(document.title).toBe('OGS');
  });
  it('does nothing while visible', () => {
    setGens(gen('a', 'done'), gen('b', 'running'), gen('c', 'running'));
    expect(document.title).toBe('OGS');
  });
  it('notifies once per batch only when enabled and granted', () => {
    hide(true);
    setGens(gen('a', 'done'), gen('b', 'running'), gen('c', 'running'));
    vi.advanceTimersByTime(BATCH_MS + 1);
    expect(Notif).not.toHaveBeenCalled(); // setting off
    useStore.setState({ settings: { ...useStore.getState().settings, notify: true } });
    setGens(gen('a', 'done'), gen('b', 'done'), gen('c', 'error'));
    vi.advanceTimersByTime(BATCH_MS + 1);
    expect(Notif).toHaveBeenCalledTimes(1);
    expect(Notif.mock.calls[0][1].body).toBe('1 generation ready · 1 failed');
  });
  it('does not notify without permission', () => {
    (Notif as unknown as { permission: string }).permission = 'default';
    useStore.setState({ settings: { ...useStore.getState().settings, notify: true } });
    hide(true);
    setGens(gen('a', 'done'), gen('b', 'running'), gen('c', 'running'));
    vi.advanceTimersByTime(BATCH_MS + 1);
    expect(Notif).not.toHaveBeenCalled();
  });
});
