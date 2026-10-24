// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { SizePresets } from '../src/components/designer/SizePresets';
import { StrokeStyleFields } from '../src/components/designer/StrokeStyleFields';
import { SIZE_PRESETS } from '../src/engine/design/brushEngine';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function mount(el: Parameters<ReturnType<typeof createRoot>['render']>[0]) { const host = document.createElement('div'); document.body.append(host); act(() => createRoot(host).render(el)); return host; }

describe('size presets', () => {
  it('the same row serves the brush and Lineart; Lineart sets its size and stays inside 1–120', () => {
    const onChange = vi.fn();
    const style = { size: 8, color: '#000000', opacity: 1, thinning: 0, smoothing: 0.5, streamline: 0.5, taperStart: 0, taperEnd: 0 } as never;
    const host = mount(createElement(StrokeStyleFields, { value: style, onChange }));
    const labels = [...host.querySelectorAll('[aria-label="Size presets"] button')].map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(SIZE_PRESETS.filter((s) => s <= 120).map((s) => `${s} px`));
    act(() => { (host.querySelector('[aria-label="48 px"]') as HTMLElement).click(); });
    expect(onChange).toHaveBeenCalledWith({ size: 48 });
    expect(host.querySelector('[aria-label="8 px"]')!.getAttribute('aria-checked')).toBe('true');
  });
  it('without a range the brush gets every preset', () => {
    const host = mount(createElement(SizePresets, { value: 200, onChange: () => {} }));
    expect(host.querySelectorAll('button')).toHaveLength(SIZE_PRESETS.length);
  });
});
