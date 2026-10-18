// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { useStore } from '../src/store/store';
import { installDoneSignal, doneText } from '../src/lib/doneSignal';
import type { Generation } from '../src/engine/types';

const T0 = 1_700_000_000_000;
const gen = (id: string, status: Generation['status'], extra: Partial<Generation> = {}) =>
  ({ id, status, kind: 'image', modelRef: 'm', modelName: 'Model X', createdAt: T0, ...extra }) as Generation;
const setGens = (...gs: Generation[]) => useStore.setState({ generations: Object.fromEntries(gs.map((g) => [g.id, g])) });
const setTabTitle = (on: boolean) => useStore.setState({ settings: { ...useStore.getState().settings, notifications: { tabTitle: on } } });
const hide = (hidden: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
};
const toasts = () => useStore.getState().ui.toasts;

describe('done signal', () => {
  let off: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    document.title = 'Open Gen Studio';
    useStore.setState({ hydrated: true, ui: { ...useStore.getState().ui, toasts: [] } });
    setTabTitle(true);
    setGens();
    off = installDoneSignal();
    setGens(gen('a', 'running')); // seen running after install: a live generation
  });
  afterEach(() => { off(); hide(false); vi.useRealTimers(); });

  it('shows the result in the title while hidden and restores the original when visible', () => {
    hide(true);
    setGens(gen('a', 'done'));
    expect(document.title).toBe('✓ Done · Open Gen Studio');
    hide(false);
    expect(document.title).toBe('Open Gen Studio');
  });

  it('a failure shows in the title', () => {
    hide(true);
    setGens(gen('a', 'error', { error: 'quota' }));
    expect(document.title).toBe('! Failed · Open Gen Studio');
  });

  it('while running in the background the title counts them', () => {
    hide(true);
    setGens(gen('a', 'running'), gen('b', 'queued'));
    expect(document.title).toBe('Open Gen Studio · 2 running');
  });

  it('does not touch the title while visible', () => {
    setGens(gen('a', 'done'));
    expect(document.title).toBe('Open Gen Studio');
  });

  it('a finish while visible does not stay in the title once hidden', () => {
    setGens(gen('a', 'done'));
    hide(true);
    expect(document.title).toBe('Open Gen Studio');
  });

  it('toast text carries kind, model, seconds and cost (only what is known)', () => {
    setGens(gen('a', 'running', { startedAt: T0 }));
    setGens(gen('a', 'done', { startedAt: T0, finishedAt: T0 + 3000, actualUsd: 0.04 }));
    expect(toasts().map((t) => [t.text, t.level])).toEqual([['Image ready · Model X · 3s · $0.04', 'success']]);
    expect(doneText(gen('x', 'done', { kind: 'video', modelName: 'V', estimate: { usd: null, approximate: true } }))).toBe('Video ready · V');
  });

  it('a failure toast carries the error text', () => {
    setGens(gen('a', 'error', { error: 'quota exceeded' }));
    expect(toasts().map((t) => [t.text, t.level])).toEqual([['Image failed · Model X · quota exceeded', 'error']]);
  });

  it('the setting off leaves the title alone; the toast still shows', () => {
    setTabTitle(false);
    hide(true);
    setGens(gen('a', 'done', { startedAt: T0, finishedAt: T0 + 1000 }));
    expect(document.title).toBe('Open Gen Studio');
    expect(toasts()).toHaveLength(1);
  });

  it('generations restored at startup never announce, even when they finish later', () => {
    off();
    hide(false);
    setGens(gen('r', 'running'));
    off = installDoneSignal(); // the restored set is the startup snapshot
    hide(true);
    setGens(gen('r', 'done'));
    expect(document.title).toBe('Open Gen Studio');
    expect(toasts()).toHaveLength(0);
  });

  it('discarded generations (their session was deleted) never announce', () => {
    setGens(gen('a', 'running'), gen('d', 'running', { discard: true }));
    hide(true);
    setGens(gen('a', 'running'), gen('d', 'done', { discard: true }));
    expect(document.title).toBe('Open Gen Studio · 1 running'); // only 'a' is announced as running
    expect(toasts()).toHaveLength(0);
  });
});
