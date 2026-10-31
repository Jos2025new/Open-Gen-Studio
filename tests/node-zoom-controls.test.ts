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

it('the zoom popover is the app slider field: name, typed percent, filled track', () => {
  const field = host.querySelector('.canvas-zoom-controls > label.opt.opt-slider');
  expect(field?.querySelector('.opt-label')?.textContent).toBe('Zoom');
  expect(field?.querySelector<HTMLInputElement>('.opt-num')?.value).toBe('100');
  expect(field?.querySelector('.opt-unit')?.textContent).toBe('%');
});

it('typing waits for an in-range value: "2" does not clamp, "250" applies, an out-of-range value clamps on leaving', async () => {
  const field = host.querySelector<HTMLInputElement>('input[aria-label="Zoom value"]')!;
  await act(async () => { field.focus(); setValue(field, '2'); });
  expect(onZoom).not.toHaveBeenCalled();
  expect(field.value).toBe('2');
  await act(async () => setValue(field, '250'));
  expect(onZoom).toHaveBeenLastCalledWith(2.5);
  await act(async () => setValue(field, '9999'));
  await act(async () => field.blur());
  expect(onZoom).toHaveBeenLastCalledWith(32);
});

it('the track runs on a log scale from 5% to 3200%; − and + step by √2', async () => {
  const slider = host.querySelector<HTMLInputElement>('input[aria-label="Zoom"]')!;
  expect(+slider.min).toBeCloseTo(Math.log2(0.05));
  expect(+slider.max).toBe(5);
  expect(+slider.value).toBe(0);
  await act(async () => setValue(slider, '2'));
  expect(onZoom).toHaveBeenLastCalledWith(4);
  await act(async () => host.querySelector<HTMLElement>('[aria-label="Zoom in"]')!.click());
  expect(onZoom).toHaveBeenLastCalledWith(Math.SQRT2);
});
