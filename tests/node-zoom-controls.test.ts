// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ZoomControls } from '../src/components/node/CanvasNavigation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const onZoom = vi.fn();
beforeEach(async () => {
  onZoom.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(ZoomControls, { zoom: 1, onZoom })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const setValue = (el: HTMLInputElement, v: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };

it('a typed percent applies on Enter, clamped to 5%–3200%', async () => {
  const field = host.querySelector<HTMLInputElement>('input[aria-label="Zoom percent"]')!;
  expect(field.value).toBe('100');
  for (const [typed, zoom] of [['2500', 25], ['9999', 32], ['1', 0.05], ['150%', 1.5]] as const) {
    await act(async () => { field.focus(); setValue(field, typed); });
    await act(async () => { field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); field.blur(); });
    expect(onZoom).toHaveBeenLastCalledWith(zoom);
  }
});

it('the slider runs on a log scale from 5% to 3200%', async () => {
  const slider = host.querySelector<HTMLInputElement>('input[aria-label="Zoom slider"]')!;
  expect(+slider.min).toBeCloseTo(Math.log2(0.05));
  expect(+slider.max).toBe(5);
  expect(+slider.value).toBe(0);
  await act(async () => setValue(slider, '2'));
  expect(onZoom).toHaveBeenLastCalledWith(4);
});
