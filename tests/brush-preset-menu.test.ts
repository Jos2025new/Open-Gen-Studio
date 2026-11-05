// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined } }));
import { BrushPresetMenu } from '../src/components/designer/BrushPresetMenu';
import { applyBrushPreset, PENCIL_PRESETS } from '../src/engine/design/brushPresets';
import { setUi, useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
const initialUi = useStore.getState().ui;
const hb = PENCIL_PRESETS.find((p) => p.id === 'pencil-hb')!;
let root: Root;
let host: HTMLDivElement;
const brush = () => useStore.getState().ui.brush;
const button = () => host.querySelector<HTMLButtonElement>('button.tool-setting')!;
const item = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.menu-item')].find((b) => b.textContent?.includes(label));
const click = (b?: HTMLElement) => act(async () => { b!.click(); });
const setSize = (size: number) => act(async () => { setUi({ brush: { ...brush(), size } }); });

beforeEach(async () => {
  useStore.setState({ ui: { ...initialUi, brush: applyBrushPreset({ size: 1, color: '#123456', opacity: 1 }, hb), brushPresets: undefined } });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(BrushPresetMenu)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useStore.setState({ ui: initialUi });
});

describe('BrushPresetMenu', () => {
  it('keeps naming the preset after a change, and Reset brings its values back with the color', async () => {
    expect(button().textContent).toBe('Pencil HB');
    await setSize(40);
    expect(button().textContent).toBe('Pencil HB •');
    await click(button());
    await click(item('Reset Pencil HB'));
    expect(button().textContent).toBe('Pencil HB');
    expect(brush()).toMatchObject({ size: hb.values.size, color: '#123456' });
  });

  it('Reset is off until a setting changes', async () => {
    await click(button());
    expect(item('Reset Pencil HB')?.disabled).toBe(true);
  });

  it('saves the tuned brush as a preset that can be updated and, after confirming, deleted', async () => {
    await setSize(40);
    await click(button());
    await click(item('Save as new preset'));
    const input = document.querySelector<HTMLInputElement>('input[aria-label="New preset name"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Mine');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { input.form!.requestSubmit(); });
    expect(useStore.getState().ui.brushPresets?.map((p) => p.label)).toEqual(['Mine']);
    expect(button().textContent).toBe('Mine');
    await setSize(50);
    expect(button().textContent).toBe('Mine •');
    await click(button());
    await click(item('Update Mine'));
    expect(useStore.getState().ui.brushPresets?.[0].values.size).toBe(50);
    expect(button().textContent).toBe('Mine');
    await click(button());
    await click(item('Delete Mine'));
    expect(useStore.getState().ui.brushPresets).toHaveLength(1);
    await click(item('Confirm: delete Mine'));
    expect(useStore.getState().ui.brushPresets).toEqual([]);
    expect(brush().size).toBe(50);
  });
});
