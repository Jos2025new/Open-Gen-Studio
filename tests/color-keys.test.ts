// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({ ui: { brush: { color: '#ffffff', secondary: '#112233' } as Record<string, unknown>, gradient: { color2: '#000000' } }, setUi: vi.fn() }));
vi.mock('../src/store/store', () => ({ setUi: (p: any) => { fx.setUi(p); Object.assign(fx.ui, p); }, useStore: { getState: () => ({ ui: fx.ui }) } }));
vi.mock('../src/engine/design/swatches', () => ({ rememberColor: vi.fn() }));

import { colorKey } from '../src/components/designer/colorKeys';

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  Object.defineProperty(e, 'target', { value: target });
  return e;
}
afterEach(() => { fx.setUi.mockClear(); fx.ui.brush = { color: '#ffffff', secondary: '#112233' }; });

describe('color keys', () => {
  it('X swaps primary and secondary', () => {
    const e = press('x');
    expect(colorKey(e)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(fx.ui.brush).toMatchObject({ color: '#112233', secondary: '#ffffff' });
  });

  it('D resets to white over black', () => {
    fx.ui.brush = { color: '#123456', secondary: '#abcdef' };
    expect(colorKey(press('D'))).toBe(true);
    expect(fx.ui.brush).toMatchObject({ color: '#ffffff', secondary: '#000000' });
  });

  it('ignores modifiers, repeats, other keys and text fields', () => {
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }]) expect(colorKey(press('x', init))).toBe(false);
    expect(colorKey(press('q'))).toBe(false);
    const input = document.createElement('input');
    document.body.append(input);
    expect(colorKey(press('x', {}, input))).toBe(false);
    input.remove();
    expect(fx.setUi).not.toHaveBeenCalled();
  });
});
