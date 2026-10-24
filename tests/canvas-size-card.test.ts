// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { CanvasSize } from '../src/components/designer/CanvasSize';
import { canDragGuides } from '../src/components/designer/drawGuides';
import { addDoc, getDoc } from '../src/engine/design/actions';
import { createDoc } from '../src/engine/design/doc';
import { FORMAT_PRESETS, presetPx } from '../src/engine/design/pageUnits';
import { sanitizeUi } from '../src/store/persistUi';
import { useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
const initialUi = useStore.getState().ui;
let root: Root; let host: HTMLDivElement; let sid: string; let id: string;
const render = async () => act(async () => root.render(createElement(CanvasSize, { sessionId: sid, doc: getDoc(sid, id)!, inline: true })));
const press = async (text: string) => { const b = [...host.querySelectorAll('button')].find((x) => x.textContent === text || x.getAttribute('aria-label') === text)!; expect(b, text).toBeTruthy(); await act(async () => b.click()); await render(); };
const input = (label: string) => [...host.querySelectorAll('label')].find((l) => l.textContent?.startsWith(label))!.querySelector('input') as HTMLInputElement;
const setVal = async (el: HTMLInputElement, v: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }); await render(); };

beforeEach(async () => {
  sid = useStore.getState().activeSessionId;
  const doc = createDoc('c', 200, 100); id = doc.id; addDoc(sid, doc);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); useStore.setState({ ui: initialUi }); });

describe('Canvas size card', () => {
  it('a preset fills W and H', async () => {
    const p = FORMAT_PRESETS.find((f) => f.id === 'story')!; const px = presetPx(p, 96);
    await act(async () => host.querySelector<HTMLButtonElement>('button.opt-pick')!.click());
    const item = [...document.querySelectorAll<HTMLElement>('[role="option"], [role="listbox"] button')].find((x) => x.textContent?.includes(p.label))!;
    expect(item).toBeTruthy(); await act(async () => item.click()); await render();
    const [w, h] = [+input('W').value, +input('H').value];
    // the page is landscape (200x100), so the preset keeps that orientation
    expect([w, h].sort((a, b) => a - b)).toEqual([px.w, px.h].sort((a, b) => a - b));
  });
  it('Portrait / Landscape swaps W and H', async () => {
    expect([input('W').value, input('H').value]).toEqual(['200', '100']);
    await press('Portrait');
    expect([input('W').value, input('H').value]).toEqual(['100', '200']);
    await press('Landscape');
    expect([input('W').value, input('H').value]).toEqual(['200', '100']);
  });
  it('another unit changes the shown values but Apply resizes to the same px', async () => {
    await press('in');
    expect(+input('W').value).toBeCloseTo(200 / 96, 1);
    await press('Apply');
    const d = getDoc(sid, id)!; expect([d.width, d.height]).toEqual([200, 100]);
  });
  it('unit and DPI survive a remount through the store', async () => {
    await press('mm'); await setVal(input('DPI'), '300');
    expect(useStore.getState().ui.pageUnit).toBe('mm'); expect(useStore.getState().ui.pageDpi).toBe(300);
    await act(async () => root.unmount()); root = createRoot(host); await render();
    expect(input('DPI').value).toBe('300');
    expect(host.querySelector('[role="radio"][aria-checked="true"], button[aria-pressed="true"]')).toBeTruthy();
  });
});

describe('persisted page prefs and guide lock', () => {
  it('loaded unit / DPI are validated', () => {
    expect(sanitizeUi({ pageUnit: 'mm', pageDpi: 300 })).toEqual({ pageUnit: 'mm', pageDpi: 300 });
    expect(sanitizeUi({ pageUnit: 'cm' as never, pageDpi: 0 })).toEqual({ pageUnit: undefined, pageDpi: undefined });
    expect(sanitizeUi({ pageDpi: 99999 }).pageDpi).toBeUndefined();
    expect(sanitizeUi({ pageDpi: NaN }).pageDpi).toBeUndefined();
  });
  it('guides drag only with Edit, shown and unlocked', () => {
    expect(canDragGuides('move', true, false)).toBe(true);
    expect(canDragGuides('move', true, true)).toBe(false);
    expect(canDragGuides('move', false, false)).toBe(false);
    expect(canDragGuides('brush', true, false)).toBe(false);
  });
});
