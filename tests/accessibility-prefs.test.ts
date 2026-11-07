// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AppearanceSection } from '../src/components/shell/AppearanceSection';
import { TEXT_SCALES, applyAccessibility, prefersReducedMotion, readIconSet, setIconSet, subscribeIconSet, watchAccessibility, readContrast, readReduceMotion, readStrongFocus, readTextScale, setContrast, setReduceMotion, setStrongFocus, stepTextScale } from '../src/lib/theme';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const root = () => document.documentElement;
const reset = () => { localStorage.clear(); root().removeAttribute('data-contrast'); root().removeAttribute('data-text-scale'); root().removeAttribute('data-motion'); root().removeAttribute('style'); root().className = ''; };
beforeEach(reset);
afterEach(reset);

it('with nothing stored: Normal contrast, 100 % text, motion follows the OS (not reduced here), normal focus', () => {
  expect(readContrast()).toBe('normal');
  expect(readTextScale()).toBe(1);
  expect(readReduceMotion()).toBe(false);
  expect(readStrongFocus()).toBe(false);
  applyAccessibility();
  expect(root().hasAttribute('data-contrast')).toBe(false);
  expect(root().hasAttribute('data-text-scale')).toBe(false);
  expect(root().className).toBe('');
});

it('the old soft-contrast key still means Soft; High is stored under the same key; anything else is Normal', () => {
  localStorage.setItem('ogs-contrast', 'soft');
  expect(readContrast()).toBe('soft');
  localStorage.setItem('ogs-contrast', 'bogus');
  expect(readContrast()).toBe('normal');
  setContrast('high');
  expect(localStorage.getItem('ogs-contrast')).toBe('high');
  expect(root().getAttribute('data-contrast')).toBe('high');
  setContrast('normal');
  expect(localStorage.getItem('ogs-contrast')).toBeNull();
  expect(root().hasAttribute('data-contrast')).toBe(false);
});

it('text size steps through the standard sizes and stops at 87.5 % and 200 %; an unknown stored value is 100 %', () => {
  for (let i = 0; i < 10; i++) stepTextScale(1);
  expect(readTextScale()).toBe(2);
  expect(root().style.getPropertyValue('--text-scale')).toBe('2');
  expect(stepTextScale(1)).toBe(2);
  for (let i = 0; i < 10; i++) stepTextScale(-1);
  expect(readTextScale()).toBe(TEXT_SCALES[0]);
  expect(stepTextScale(-1)).toBe(0.875);
  stepTextScale(1);
  expect(readTextScale()).toBe(1);
  expect(root().hasAttribute('data-text-scale')).toBe(false);
  localStorage.setItem('ogs-text-scale', '3.3');
  expect(readTextScale()).toBe(1);
});

it('reduce motion and stronger focus set root classes; an explicit motion off overrides the OS default', () => {
  setReduceMotion(true);
  setStrongFocus(true);
  expect(root().classList.contains('reduce-motion')).toBe(true);
  expect(root().classList.contains('focus-strong')).toBe(true);
  expect(readReduceMotion()).toBe(true);
  setReduceMotion(false);
  setStrongFocus(false);
  expect(root().classList.contains('reduce-motion')).toBe(false);
  expect(root().getAttribute('data-motion')).toBe('full');
  expect(localStorage.getItem('ogs-focus')).toBeNull();
});

it('the Accessibility group offers Contrast, Text size (- and +), Reduce motion and Stronger focus, wired to the root', () => {
  const host = document.createElement('div');
  act(() => createRoot(host).render(createElement(AppearanceSection)));
  expect(host.querySelector('.set-group[aria-label="Accessibility"]')).not.toBeNull();
  const click = (el: Element | null) => act(() => (el as HTMLElement).click());
  click([...host.querySelectorAll('[role="radio"]')].find((b) => b.textContent === 'High') ?? null);
  expect(root().getAttribute('data-contrast')).toBe('high');
  click(host.querySelector('[aria-label="Larger text"]'));
  expect(host.querySelector('output')?.textContent).toBe('112.5 %');
  expect(root().getAttribute('data-text-scale')).toBe('1.125');
  click(host.querySelector('[role="switch"][aria-label="Reduce motion"]'));
  click(host.querySelector('[role="switch"][aria-label="Stronger focus"]'));
  expect(root().classList.contains('reduce-motion') && root().classList.contains('focus-strong')).toBe(true);
});

it('the CSS: High is the inverse of Soft on text and lines, and the text scale multiplies the size tokens', () => {
  const high = readFileSync('src/styles/high-contrast.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  expect(high).toMatch(/html\[data-contrast="high"\] body \{[^}]*--text: var\(--hc-ink\)/);
  expect(high).toMatch(/--border: color-mix\(in oklab, var\(--hc-ink\)/);
  expect(high).toMatch(/\[data-base="claro"\][^{]*\{ --hc-ink: #000/);
  const acc = readFileSync('src/styles/accessibility.css', 'utf8');
  expect(acc).toMatch(/html \{ font-size: calc\(16px \* var\(--text-scale, 1\)\); \}/);
  expect(acc).toMatch(/html\.focus-strong :focus-visible \{[^}]*var\(--accent\)/);
  expect(acc).toMatch(/html\.reduce-motion \*/);
});

it('stepping text size keeps working when localStorage throws (the in-memory value is the base)', () => {
  const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  const rm = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
  try {
    const start = stepTextScale(-1); // from wherever the module is: 87.5 % or one below
    for (let i = 0; i < 10; i++) stepTextScale(-1);
    expect(stepTextScale(1)).toBe(1);
    expect(stepTextScale(1)).toBe(1.125);
    expect(stepTextScale(1)).toBe(1.25);
    expect(root().style.getPropertyValue('--text-scale')).toBe('1.25');
    expect(readTextScale()).toBe(1.25);
    expect(start).toBeLessThanOrEqual(1);
  } finally { spy.mockRestore(); set.mockRestore(); rm.mockRestore(); }
});

it('follows prefers-reduced-motion live until the user chooses, and prefersReducedMotion() reads the effective setting', () => {
  let reduced = false;
  let fire: () => void = () => undefined;
  const mm = vi.fn(() => ({ get matches() { return reduced; }, addEventListener: (_: string, f: () => void) => { fire = f; }, removeEventListener: () => undefined }));
  vi.stubGlobal('matchMedia', mm);
  try {
    const stop = watchAccessibility();
    expect(prefersReducedMotion()).toBe(false);
    reduced = true; fire();
    expect(root().classList.contains('reduce-motion')).toBe(true);
    expect(prefersReducedMotion()).toBe(true);
    setReduceMotion(false);
    reduced = true; fire();
    expect(root().classList.contains('reduce-motion')).toBe(false);
    expect(prefersReducedMotion()).toBe(false);
    stop();
  } finally { vi.unstubAllGlobals(); }
});

it('a storage event from another tab updates contrast, text size, motion, focus and the icon set; one shared listener serves every icon', () => {
  const add = vi.spyOn(window, 'addEventListener');
  const calls: string[] = [];
  const unsubs = Array.from({ length: 5 }, () => subscribeIconSet(() => calls.push('i')));
  expect(add.mock.calls.filter((c) => c[0] === 'storage').length).toBeLessThanOrEqual(1);
  add.mockRestore();
  localStorage.setItem('ogs-contrast', 'high'); window.dispatchEvent(new StorageEvent('storage', { key: 'ogs-contrast' }));
  expect(root().getAttribute('data-contrast')).toBe('high');
  localStorage.setItem('ogs-text-scale', '1.5'); window.dispatchEvent(new StorageEvent('storage', { key: 'ogs-text-scale' }));
  expect(root().getAttribute('data-text-scale')).toBe('1.5');
  localStorage.setItem('ogs-motion', 'on'); window.dispatchEvent(new StorageEvent('storage', { key: 'ogs-motion' }));
  expect(root().classList.contains('reduce-motion')).toBe(true);
  localStorage.setItem('ogs-focus', 'on'); window.dispatchEvent(new StorageEvent('storage', { key: 'ogs-focus' }));
  expect(root().classList.contains('focus-strong')).toBe(true);
  localStorage.setItem('ogs-icon-set', 'phosphor'); window.dispatchEvent(new StorageEvent('storage', { key: 'ogs-icon-set' }));
  expect(readIconSet()).toBe('phosphor');
  expect(calls.length).toBe(5);
  unsubs.forEach((u) => u());
  setIconSet('lucide');
});

it('the CSS: icon and control tokens follow Text size too', () => {
  const tokens = readFileSync('src/styles/tokens.css', 'utf8');
  for (const t of ['--control-h', '--control-icon', '--feed-icon', '--topbar-h']) expect(tokens).toMatch(new RegExp(`${t}: [\\d.]+rem`));
});

it('text size keeps stepping when storage is full (setItem throws, getItem still returns the old value)', () => {
  for (let i = 0; i < 10; i++) stepTextScale(-1);
  stepTextScale(1); // 0.875 → 1, stored as removed
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  expect(stepTextScale(1)).toBe(1.125);
  expect(stepTextScale(1)).toBe(1.25);
  set.mockRestore();
});

it('the open Settings panel follows another tab: a storage event with a new text size / contrast is shown, and - / + step from it', () => {
  applyAccessibility();
  const host = document.createElement('div');
  act(() => createRoot(host).render(createElement(AppearanceSection)));
  const click = (el: Element | null) => act(() => (el as HTMLElement).click());
  expect(host.querySelector('output')?.textContent).toBe('100 %');
  localStorage.setItem('ogs-text-scale', '1.5');
  localStorage.setItem('ogs-contrast', 'high');
  act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'ogs-text-scale' })); window.dispatchEvent(new StorageEvent('storage', { key: 'ogs-contrast' })); });
  expect(host.querySelector('output')?.textContent).toBe('150 %');
  expect([...host.querySelectorAll('[role="radio"]')].find((b) => b.textContent === 'High')?.getAttribute('aria-checked')).toBe('true');
  click(host.querySelector('[aria-label="Larger text"]'));
  expect(host.querySelector('output')?.textContent).toBe('175 %');
});
