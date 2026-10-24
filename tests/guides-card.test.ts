// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { GuidesCard } from '../src/components/designer/GuidesCard';
import { ViewToggles } from '../src/components/designer/ToolHelp';
import { TOOLBOX } from '../src/components/designer/toolboxModel';
import { addDoc, getDoc, undoDoc } from '../src/engine/design/actions';
import { createDoc } from '../src/engine/design/doc';
import { useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initialUi = useStore.getState().ui;
let root: Root; let host: HTMLDivElement; let sid: string; let id: string;
const render = async () => act(async () => root.render(createElement(GuidesCard, { sessionId: sid, doc: getDoc(sid, id)! })));
const press = async (text: string) => { const b = [...host.querySelectorAll('button')].find((x) => x.textContent === text || x.getAttribute('aria-label') === text)!; expect(b, text).toBeTruthy(); await act(async () => b.click()); await render(); };

beforeEach(async () => {
  sid = useStore.getState().activeSessionId;
  const doc = createDoc('g', 200, 100); id = doc.id; addDoc(sid, doc);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); useStore.setState({ ui: initialUi }); });

describe('Layout → Guides', () => {
  it('is a real variant, not Soon', () => {
    const g = TOOLBOX.find((f) => f.id === 'layout')!.variants.find((x) => x.id === 'guides')!;
    expect(g.soon).toBeUndefined(); expect(g.action).toBe('guides');
  });
  it('the zoom panel no longer has the Ruler button but keeps the help toggle', async () => {
    await act(async () => root.render(createElement(ViewToggles)));
    expect(host.querySelector('button[aria-label*="rulers"]')).toBeNull();
    expect(host.querySelector('button[aria-label*="tool help"]')).toBeTruthy();
  });
  it('switches set the ui flags', async () => {
    await press('Show rulers'); expect(useStore.getState().ui.rulers).toBe(true);
    await press('Show guides'); expect(useStore.getState().ui.showGuides).toBe(false);
    await press('Lock guides'); expect(useStore.getState().ui.lockGuides).toBe(true);
  });
  it('adds in px and %, around the page, and clears, each undoable', async () => {
    const pos = host.querySelector<HTMLInputElement>('input[aria-label="Guide position"]')!;
    const set = async (v: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(pos, v); pos.dispatchEvent(new Event('input', { bubbles: true })); }); await render(); };
    await set('30'); await press('Add');
    expect(getDoc(sid, id)!.guides).toEqual({ x: [30], y: [] });
    await press('Horizontal'); await press('%'); await set('50'); await press('Add');
    expect(getDoc(sid, id)!.guides).toEqual({ x: [30], y: [50] });
    await press('Guides around page');
    expect(getDoc(sid, id)!.guides).toEqual({ x: [30, 0, 200], y: [50, 0, 100] });
    await press('Clear all guides');
    expect(getDoc(sid, id)!.guides).toBeUndefined();
    undoDoc(sid, id);
    expect(getDoc(sid, id)!.guides!.x.length).toBe(3);
  });
});
