// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { BrushSizeField, sizeRangeOf } from '../src/components/designer/BrushSizeField';
import { PENCIL_PRESETS, presetEdited } from '../src/engine/design/brushPresets';
import { SIZE_PRESETS } from '../src/engine/design/brushEngine';
import { useStore, setUi } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const brush = () => useStore.getState().ui.brush;
function mount() { const host = document.createElement('div'); document.body.append(host); act(() => createRoot(host).render(createElement(BrushSizeField))); return host; }
const setNative = (el: HTMLInputElement, v: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); };
const range = (h: HTMLElement) => h.querySelector('input[type=range]') as HTMLInputElement;
const num = (h: HTMLElement) => h.querySelector('input[type=number]') as HTMLInputElement;
const badge = (h: HTMLElement) => h.querySelector('.opt-size-range') as HTMLButtonElement;
const type = (h: HTMLElement, v: string) => act(() => { setNative(num(h), v); num(h).dispatchEvent(new Event('input', { bubbles: true })); });
const drag = (h: HTMLElement, v: string) => act(() => { setNative(range(h), v); range(h).dispatchEvent(new Event('input', { bubbles: true })); });

describe('brush Size field', () => {
  beforeEach(() => act(() => setUi({ brush: { ...brush(), size: 50, sizeRange: undefined } })));

  it('the track is linear over 1–100 by default: 50 px sits about halfway and every pixel weighs the same', () => {
    const h = mount();
    expect(badge(h).textContent).toBe('×1');
    expect([range(h).min, range(h).max, range(h).step]).toEqual(['1', '100', '1']);
    expect(parseFloat((h.firstChild as HTMLElement).style.getPropertyValue('--fill'))).toBeCloseTo(49.49, 1);
    drag(h, '73');
    expect(brush().size).toBe(73);
  });
  it('the badge changes the range and brings a size outside it to the nearest edge', () => {
    const h = mount();
    act(() => badge(h).click());
    expect(badge(h).textContent).toBe('×10');
    expect([range(h).min, range(h).max, range(h).step]).toEqual(['10', '1000', '10']);
    expect(brush().size).toBe(50);
    act(() => setUi({ brush: { ...brush(), size: 400 } }));
    act(() => badge(h).click());
    expect(brush()).toMatchObject({ size: 100, sizeRange: 1 });
    act(() => setUi({ brush: { ...brush(), size: 5 } }));
    act(() => badge(h).click());
    expect(brush()).toMatchObject({ size: 10, sizeRange: 10 });
  });
  it('typing any size from 1 to 1000 moves to the range that holds it', () => {
    const h = mount();
    type(h, '500');
    expect(brush().size).toBe(500);
    expect(badge(h).textContent).toBe('×10');
    type(h, '5');
    expect(brush().size).toBe(5);
    expect(badge(h).textContent).toBe('×1');
    act(() => { num(h).focus(); });
    type(h, '5000');
    expect(brush().size).toBe(5);
    act(() => { num(h).blur(); });
    expect(brush().size).toBe(1000);
  });
  it('dragging down inside ×10 stays in ×10 instead of jumping scale under the hand', () => {
    const h = mount();
    type(h, '500');
    drag(h, '90');
    expect(brush().size).toBe(90);
    expect(badge(h).textContent).toBe('×10');
  });
  it('a size set elsewhere (a preset) shows in the range that holds it', () => {
    expect(sizeRangeOf(200, 1)).toBe(10);
    expect(sizeRangeOf(5, 10)).toBe(1);
    expect(sizeRangeOf(48, 10)).toBe(10);
    expect(sizeRangeOf(48, 1)).toBe(1);
    expect(sizeRangeOf(48, undefined)).toBe(1);
  });
  it('the range is not a brush setting: changing it does not mark a preset as edited', () => {
    const preset = PENCIL_PRESETS[0];
    expect(presetEdited({ ...preset.values, sizeRange: 10 } as never, preset)).toBe(false);
  });
  it('the one-click sizes keep their 14 buttons and now cover the fine sizes the linear track gives little travel', () => {
    expect(SIZE_PRESETS).toHaveLength(14);
    expect(SIZE_PRESETS.slice(0, 4)).toEqual([1, 2, 3, 5]);
  });
});
