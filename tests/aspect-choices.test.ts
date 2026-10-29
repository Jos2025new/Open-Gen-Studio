// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AspectChoices } from '../src/components/composer/AspectChoices';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('shows common ratios first, expands all, and retains an uncommon selection when folded', () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const values = ['1:2', '2:1', '1:1', '16:9', '9:16', '4:3', 'auto', '21:9'];
  const select = vi.fn();
  const render = (selected: string) => root.render(createElement(AspectChoices, { values, selected, onSelect: select, label: 'Aspect ratio', compact: true }));
  act(() => render('1:1'));
  const choices = () => [...host.querySelectorAll<HTMLButtonElement>('.fmt-opt')];
  const toggle = () => host.querySelector<HTMLButtonElement>('.space-aspect-more')!;
  expect(choices().map((button) => button.textContent)).toEqual(['Auto', '1:1', '16:9', '9:16', '4:3']);
  expect(toggle().textContent).toBe('3 more');
  act(() => toggle().click());
  expect(choices()).toHaveLength(values.length);
  act(() => choices().find((button) => button.textContent === '21:9')!.click());
  expect(select).toHaveBeenCalledWith('21:9');
  act(() => render('21:9'));
  act(() => toggle().click());
  expect(choices()).toHaveLength(5);
  expect(choices().find((button) => button.textContent === '21:9')?.getAttribute('aria-pressed')).toBe('true');
  act(() => root.unmount());
});
