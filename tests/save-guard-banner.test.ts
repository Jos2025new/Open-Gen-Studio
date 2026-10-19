// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ set: vi.fn(async (..._a: unknown[]) => 'ok'), revert: vi.fn(async () => undefined) }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: mocks.set, del: async () => undefined, revertToDisk: mocks.revert },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined, putAssetBlob: async () => undefined,
}));

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SaveGuardBanner } from '../src/components/shell/SaveGuardBanner';
import { failSave, hasPendingSave, markStateDirty, beginStateSave, resetSaveStatus, saveStatus } from '../src/store/saveStatus';
import { reportSave } from '../src/store/saveReport';
import { guard, setProblem } from '../src/lib/saveGuard';
import { page } from '../src/store/saveRecovery';
import { useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const sid = () => Object.keys(useStore.getState().sessions)[0];
const click = async (label: string) => { await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent === label)!.click(); }); };
const labels = () => [...host.querySelectorAll('button')].map((b) => b.textContent);
const render = async () => { await act(async () => { root.render(createElement(SaveGuardBanner)); }); };
const lose = () => {
  setProblem({ reason: 'possible-loss', sessionId: sid(), rejectedFile: 'rejected-x.json', diskHash: 'h' });
  const v = markStateDirty();
  beginStateSave(v);
  reportSave(v, 'rejected');
};

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  mocks.set.mockClear(); mocks.revert.mockClear();
});
afterEach(() => { act(() => root.unmount()); host.remove(); resetSaveStatus(); guard.pending = undefined; setProblem(null); });

describe('13: the save notice', () => {
  it('is empty while saving works', async () => {
    await render();
    expect(host.textContent).toBe('');
  });

  it('possible-loss: names the session, stays until resolved, offers the three ways out', async () => {
    useStore.setState({ sessions: { ...useStore.getState().sessions, [sid()]: { ...useStore.getState().sessions[sid()], title: 'Harbour film' } } });
    lose();
    await render();
    expect(host.textContent).toContain('Changes to "Harbour film" are not being saved to disk');
    expect(labels()).toEqual(['Download copy', 'Keep this version', 'Revert to disk version']);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(host.textContent).toContain('Harbour film'); // not auto-dismissed
  });

  it('conflict: says another tab saved, without "Keep this version"', async () => {
    failSave('Another tab saved changes', true, undefined, { reason: 'conflict', rejected: null });
    await render();
    expect(host.textContent).toContain('Another tab saved more recent changes');
    expect(labels()).toEqual(['Download copy', 'Revert to disk version']);
  });

  it('Download copy hands over the in-memory state without the API keys', async () => {
    lose();
    useStore.setState((s) => ({ settings: { ...s.settings, keys: { ...s.settings.keys, fal: 'SECRET-KEY-VALUE' } } }));
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return 'blob:x'; });
    URL.revokeObjectURL = vi.fn();
    const anchor = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await render();
    await click('Download copy');
    expect(blobs).toHaveLength(1);
    const copy = JSON.parse(await blobs[0].text());
    expect(Object.keys(copy.sessions)).toContain(sid());
    expect(copy.settings.keys).toBeUndefined();
    expect(JSON.stringify(copy)).not.toContain('SECRET-KEY-VALUE');
    anchor.mockRestore();
  });

  it('Keep this version sends the rejected session once', async () => {
    lose();
    await render();
    await click('Keep this version');
    expect(mocks.set).toHaveBeenCalledTimes(1);
    expect(mocks.set.mock.calls[0][2]).toEqual({ keep: true });
  });

  it('Revert asks first in the page (no native confirm) and Cancel changes nothing', async () => {
    const native = vi.spyOn(window, 'confirm');
    const reload = vi.spyOn(page, 'reload').mockImplementation(() => undefined);
    lose();
    await render();
    await click('Revert to disk version');
    expect(host.textContent).toContain('Replace this tab');
    expect(labels()).toEqual(['Cancel', 'Revert to disk version']);
    await click('Cancel');
    expect(mocks.revert).not.toHaveBeenCalled();
    await click('Revert to disk version');
    await click('Revert to disk version');
    expect(mocks.revert).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(native).not.toHaveBeenCalled();
  });
});

describe('12: leaving the page', () => {
  it('a refused save or unsent work asks before closing; nothing pending does not', () => {
    const leave = () => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
    expect(hasPendingSave()).toBe(false);
    expect(leave()).toBe(false);
    lose();
    expect(saveStatus.getState().reason).toBe('possible-loss');
    expect(hasPendingSave()).toBe(true);
    expect(leave()).toBe(true);
    resetSaveStatus();
    expect(hasPendingSave()).toBe(false);
    guard.pending = { rev: 1, baseAt: 5 }; // unsent work from before a reload
    expect(hasPendingSave()).toBe(true);
    expect(leave()).toBe(true);
  });
});
