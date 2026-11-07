// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Eye, Group } from '../src/components/ui/icons';
import { setIconSet } from '../src/lib/theme';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { localStorage.clear(); act(() => setIconSet('lucide')); });

function render(el: ReturnType<typeof createElement>) {
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(el));
  return { host, root };
}

it('renders Lucide by default, Phosphor when chosen (live), keeps the lucide-* class and size, and falls back to Lucide with no equivalent', () => {
  const { host, root } = render(createElement('div', null, createElement(Eye, { size: 16, className: 'x' }), createElement(Group, { size: 16 })));
  const svgs = () => [...host.querySelectorAll('svg')];
  expect(svgs()[0].classList.contains('lucide')).toBe(true);
  expect(svgs()[0].getAttribute('width')).toBe('16');
  expect((svgs()[0] as SVGElement).style.width).toBe('');
  expect((svgs()[0] as SVGElement).style.getPropertyValue('--icon-size')).toBe('16px');

  act(() => setIconSet('phosphor'));
  expect(svgs()[0].classList.contains('lucide')).toBe(false);
  expect(svgs()[0].classList.contains('lucide-eye')).toBe(true);
  expect(svgs()[0].classList.contains('x')).toBe(true);
  expect(svgs()[0].getAttribute('width')).toBe('16');
  expect((svgs()[0] as SVGElement).style.width).toBe('');
  expect((svgs()[0] as SVGElement).style.getPropertyValue('--icon-size')).toBe('16px');
  expect(svgs()[0].getAttribute('viewBox')).toBe('0 0 256 256');
  // Group has no Phosphor equivalent: still the Lucide icon
  expect(svgs()[1].classList.contains('lucide')).toBe(true);

  act(() => setIconSet('obra'));
  expect(svgs()[0].classList.contains('obra-icon')).toBe(true);
  expect(localStorage.getItem('ogs-icon-set')).toBe('obra');
  act(() => root.unmount());
});

it('a numeric size never becomes inline width/height (a stylesheet size still wins) and the caller style is kept', () => {
  const { host, root } = render(createElement(Eye, { size: 16, style: { color: 'red' } }));
  const svg = host.querySelector('svg') as SVGElement;
  expect(svg.style.width).toBe('');
  expect(svg.style.height).toBe('');
  expect(svg.style.color).toBe('red');
  expect(svg.getAttribute('width')).toBe('16');
  // the only thing that turns --icon-size into a box is a zero-specificity rule, so any real rule beats it
  const css = readFileSync('src/styles/accessibility.css', 'utf8');
  expect(css).toMatch(/:where\(svg\[style\*="--icon-size"\]\) \{\s*width: calc\(var\(--icon-size\) \* var\(--text-scale, 1\)\)/);
  // no size prop: no custom property at all, the stylesheet sizes it
  act(() => root.render(createElement(Eye)));
  expect((host.querySelector('svg') as SVGElement).getAttribute('style') ?? '').not.toContain('--icon-size');
  act(() => root.unmount());
});
