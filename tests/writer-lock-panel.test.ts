// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { idbKeyval, resetWorld, settle } from './helpers/fakeTabs';

/*
 * Plan 1.4, test 15e: the read-only panel covers the app and blocks keys and pointer, and a tab without the lock
 * generates nothing and calls no provider.
 */
vi.mock('idb-keyval', () => idbKeyval());
vi.mock('../src/engine/design/raster', () => ({ flushRaster: async () => undefined, pendingRaster: () => [] }));
vi.mock('../src/lib/log', () => ({ logEvent: () => undefined, logged: (_: string, f: unknown) => f, logSettled: async () => undefined }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const calls = vi.hoisted(() => [] as string[]);
const ref = 'atlas::google/nano-banana-2-lite/text-to-image';
let host: HTMLDivElement, rootEl: HTMLDivElement, root: Root;

async function openTab() {
  vi.resetModules();
  const lock = await import('../src/lib/writerLock');
  const store = await import('../src/store/store');
  await import('../src/store/writerHandoff');
  const jobs = await import('../src/engine/jobs');
  const runtime = await import('../src/engine/agent/runtime');
  const panel = await import('../src/components/shell/WriterLockPanel');
  return { lock, store, jobs, runtime, panel };
}
const show = async (t: Awaited<ReturnType<typeof openTab>>) => { await act(async () => { root.render(createElement(t.panel.WriterLockPanel)); }); };
const buttons = () => [...document.body.querySelectorAll('.writer-lock button')].map((b) => b.textContent);

beforeEach(() => {
  resetWorld();
  calls.length = 0;
  vi.stubGlobal('fetch', async (url: string) => { calls.push(url); return url === '/x/store/ping' ? new Response('ok') : new Response(null, { status: 204 }); });
  rootEl = document.createElement('div'); rootEl.id = 'root'; document.body.append(rootEl);
  host = document.createElement('div'); rootEl.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

describe('test 15e: the read-only panel', () => {
  it('covers the app with "Use here" when the lock is elsewhere, and blocks focus and keys', async () => {
    const a = await openTab();
    await settle();
    const b = await openTab();
    await settle();
    expect(a.lock.holdsWriterLock()).toBe(true);
    await show(b);
    expect(document.body.querySelector('.writer-lock')?.textContent).toContain('Open Gen Studio is open in another tab');
    expect(buttons()).toEqual(['Use here']);
    expect(rootEl.hasAttribute('inert')).toBe(true);
    // A key outside the panel never reaches the app's own listeners.
    const seen: string[] = [];
    const keep = (e: Event) => seen.push(e.type);
    window.addEventListener('keydown', keep);
    const outside = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(true);
    expect(seen).toEqual([]);
    window.removeEventListener('keydown', keep);
  });

  it('shows its own text and no button in a browser without Web Locks', async () => {
    Object.defineProperty(globalThis.navigator, 'locks', { value: undefined, configurable: true });
    const t = await openTab();
    await show(t);
    expect(document.body.querySelector('.writer-lock')?.textContent).toContain('This browser cannot save safely');
    expect(buttons()).toEqual([]);
  });

  it('the panel appears in the holder while another tab waits, and in the old tab after handing over', async () => {
    const a = await openTab();
    await settle();
    await show(a);
    expect(document.body.querySelector('.writer-lock')).toBeNull(); // the holder is not covered
    const b = await openTab();
    await settle();
    b.lock.useHere();
    await settle();
    expect(a.lock.holdsWriterLock()).toBe(false);
    expect(document.body.querySelector('.writer-lock')?.textContent).toContain('Open Gen Studio is open in another tab');
    expect(buttons()).toEqual(['Use here']);
  });

  it('a tab without the lock starts no generation and calls no provider; the agent does not take a message', async () => {
    const a = await openTab();
    await settle();
    const b = await openTab();
    await settle();
    expect(b.lock.holdsWriterLock()).toBe(false);
    calls.length = 0; // tab A's own loading is not the question
    const st = b.store.useStore.getState();
    b.store.useStore.setState({ settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'k' } } });
    const g = b.jobs.createGeneration({ sessionId: st.activeSessionId, kind: 'image', prompt: 'x', modelRef: ref, settings: { count: 1, advanced: {} }, inputs: { refs: [] }, origin: 'composer' });
    await expect(b.jobs.runGeneration(g.id)).rejects.toThrow('open in another tab');
    expect(b.store.useStore.getState().generations[g.id].status).not.toBe('running');
    await b.runtime.sendAgentMessage('make a picture');
    const sess = b.store.useStore.getState().sessions[st.activeSessionId];
    expect(sess.feed.some((f) => f.type === 'user')).toBe(false);
    expect(sess.agent.busy).toBe(false);
    expect(calls.filter((u) => u !== '/x/store/ping')).toEqual([]);
    expect(a.lock.holdsWriterLock()).toBe(true);
  });
});
