// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, expect, it, vi } from 'vitest';
import { ListFilter } from 'lucide-react';
import { ResultsMenu } from '../src/components/ui/ResultsMenu';
import { FilterMenu } from '../src/components/ui/FilterMenu';
import { Popover, usePopover } from '../src/components/ui/Popover';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
afterAll(() => vi.unstubAllGlobals());

it('keeps Director menus in the model panel and marks the open trigger', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement('div', { className: 'agent-model-pop' },
    createElement(ResultsMenu, { label: 'Filter by', icon: ListFilter, children: 'Filters' }),
    createElement(FilterMenu, { label: 'Order by', value: 'first', options: [['first', 'First']], onChange: () => {} }),
  )));
  const panel = host.querySelector<HTMLElement>('.agent-model-pop')!;
  panel.getBoundingClientRect = () => ({ left: 200, right: 520, top: 0, bottom: 600, width: 320, height: 600, x: 200, y: 0, toJSON() {} });
  const filter = host.querySelector<HTMLButtonElement>('[aria-label="Filter by"]')!;
  filter.getBoundingClientRect = () => ({ left: 210, right: 260, top: 100, bottom: 130, width: 50, height: 30, x: 210, y: 100, toJSON() {} });
  act(() => filter.click());
  const popup = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Filter by"]')!;
  expect(popup.style.left).toBe('200px');
  expect(popup.dataset.placement).toBe('bottom-start');
  expect(filter.hasAttribute('data-popover-open')).toBe(true);
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(filter.hasAttribute('data-popover-open')).toBe(false);
  const order = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Order by'))!;
  order.getBoundingClientRect = filter.getBoundingClientRect;
  act(() => order.click());
  expect(document.querySelector<HTMLElement>('[role="dialog"][aria-label="Order by"]')?.dataset.placement).toBe('bottom-start');
  act(() => root.unmount());
  host.remove();
});

it('aligns the workspace menu with the trigger within the composer', () => {
  function WorkspaceControl() {
    const pop = usePopover();
    return createElement('div', { className: 'composer-dock' },
      createElement('button', { ref: pop.ref, onClick: pop.toggle }, 'Chat'),
      createElement(Popover, { open: pop.open, anchor: pop.ref, onClose: pop.close, width: 240, align: 'start', boundarySelector: '.composer-dock', label: 'Canvases', children: 'Canvas options' }),
    );
  }
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(WorkspaceControl)));
  host.querySelector<HTMLElement>('.composer-dock')!.getBoundingClientRect = () => ({ left: 200, right: 600, top: 0, bottom: 600, width: 400, height: 600, x: 200, y: 0, toJSON() {} });
  const button = host.querySelector('button')!;
  button.getBoundingClientRect = () => ({ left: 210, right: 260, top: 300, bottom: 330, width: 50, height: 30, x: 210, y: 300, toJSON() {} });
  act(() => button.click());
  expect(document.querySelector<HTMLElement>('[role="dialog"][aria-label="Canvases"]')?.style.left).toBe('210px');
  act(() => root.unmount()); host.remove();
});

it('keeps a start-aligned session menu to the right of its trigger on narrow screens', () => {
  function SessionControl() {
    const pop = usePopover();
    return createElement('div', null,
      createElement('button', { ref: pop.ref, onClick: pop.toggle }, 'Session'),
      createElement(Popover, { open: pop.open, anchor: pop.ref, onClose: pop.close, width: 320, align: 'start', placement: 'bottom-start', label: 'Sessions', children: 'Session options' }),
    );
  }
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(SessionControl)));
  const button = host.querySelector('button')!;
  const left = window.innerWidth - 140;
  button.getBoundingClientRect = () => ({ left, right: left + 50, top: 20, bottom: 50, width: 50, height: 30, x: left, y: 20, toJSON() {} });
  act(() => button.click());
  const popup = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Sessions"]')!;
  expect(popup.style.left).toBe(`${left}px`);
  expect(popup.style.width).toBe('132px');
  act(() => root.unmount()); host.remove();
});
