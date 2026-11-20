// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined } }));
import { BudgetTab } from '../src/components/shell/settings/BudgetTab';
import { DataTab } from '../src/components/shell/settings/DataTab';
import { useStore } from '../src/store/store';

/* One register of silenceable notices (Settings → Budget), and it follows the store: "Ask every time" shows at once. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initial = useStore.getState();
afterEach(() => { useStore.setState(initial, true); });

function mount(el: Parameters<typeof createElement>[0]) {
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(createElement(el as never)));
  return { host, root };
}
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text);

it('the drawing prompt row shows the saved answer and comes back at once with «Ask every time»', () => {
  useStore.setState({ ui: { ...initial.ui, drawingChoice: 'flatten' }, settings: { ...initial.settings, mutedNotices: [] } });
  const { host, root } = mount(BudgetTab);
  expect(host.textContent).toContain('Flatten and paint');
  const back = button(host, 'Ask every time');
  expect(back).toBeTruthy();
  act(() => back!.click());
  expect(useStore.getState().ui.drawingChoice).toBe('ask');
  expect(button(host, 'Ask every time')).toBeUndefined();
  expect(host.textContent).not.toContain('Flatten and paint');
  // A saved answer from the Drawing prompt (elsewhere) shows here too, without reopening Settings.
  act(() => useStore.setState((s) => ({ ui: { ...s.ui, drawingChoice: 'newLayer' } })));
  expect(host.textContent).toContain('New layer');
  act(() => root.unmount());
});

it('send-uncertain silences and comes back from the same register', () => {
  useStore.setState({ settings: { ...initial.settings, mutedNotices: [] } });
  const { host, root } = mount(BudgetTab);
  act(() => button(host, 'Don\u2019t show again')!.click());
  expect(useStore.getState().settings.mutedNotices).toEqual(['send-uncertain']);
  act(() => button(host, 'Show again')!.click());
  expect(useStore.getState().settings.mutedNotices).toEqual([]);
  act(() => root.unmount());
});

it('the register is the only control: Settings → Data has no second drawing-prompt control', () => {
  useStore.setState({ ui: { ...initial.ui, drawingChoice: 'design' } });
  const { host, root } = mount(DataTab);
  expect(host.textContent).not.toContain('Painting on layers');
  expect(button(host, 'Ask every time')).toBeUndefined();
  act(() => root.unmount());
});
