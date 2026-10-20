// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { AppearanceSection } from '../src/components/shell/AppearanceSection';
import { ACCENT_CHOICES, BASE_CHOICES, applyTheme, readTheme, setAccent, setBase } from '../src/lib/theme';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const html = document.documentElement;
type Listener = () => void;
let light = false;
let listeners: Listener[] = [];
function mockMedia() {
  vi.stubGlobal('matchMedia', (q: string) => ({
    get matches() { return q === '(prefers-color-scheme: light)' && light; },
    addEventListener: (_: string, l: Listener) => listeners.push(l),
    removeEventListener: (_: string, l: Listener) => (listeners = listeners.filter((x) => x !== l)),
  }));
}
let host: HTMLDivElement;
let root: Root;
const mount = () => act(() => root.render(createElement(AppearanceSection)));
const radios = () => [...host.querySelectorAll<HTMLButtonElement>('[role=radio]')];
const swatches = () => [...host.querySelectorAll<HTMLButtonElement>('.accent-swatch')];

beforeEach(() => {
  localStorage.clear();
  html.removeAttribute('data-base');
  html.removeAttribute('data-accent');
  light = false;
  listeners = [];
  mockMedia();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Settings → Appearance', () => {
  it('renders both rows in order and shows the current choice', () => {
    localStorage.setItem('ogs-base', 'grafito');
    localStorage.setItem('ogs-accent', 'rosa');
    mount();
    expect(radios().map((b) => b.textContent)).toEqual(['System', 'Atlas', 'Graphite', 'Light', 'Original (old)']);
    expect(radios().filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.textContent)).toEqual(['Graphite']);
    expect(swatches().map((b) => b.getAttribute('aria-label'))).toEqual(['Default (lime)', 'Blue', 'Violet', 'Pink', 'Aqua', 'Aurora']);
    expect(swatches().filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('aria-label'))).toEqual(['Pink']);
    expect(swatches().find((b) => b.getAttribute('aria-pressed') === 'true')?.querySelector('svg')).toBeTruthy();
  });

  it('defaults to Atlas and lime selected when nothing is stored', () => {
    mount();
    expect(radios().find((b) => b.getAttribute('aria-checked') === 'true')?.textContent).toBe('Atlas');
    expect(swatches()[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('clicking applies the attributes at once and saves to localStorage', () => {
    mount();
    act(() => radios()[3].click());
    act(() => swatches()[4].click());
    expect(html.getAttribute('data-base')).toBe('claro');
    expect(html.getAttribute('data-accent')).toBe('agua');
    expect(localStorage.getItem('ogs-base')).toBe('claro');
    expect(localStorage.getItem('ogs-accent')).toBe('agua');
    expect(radios()[3].getAttribute('aria-checked')).toBe('true');
    expect(swatches()[4].getAttribute('aria-pressed')).toBe('true');
    expect(swatches()[0].getAttribute('aria-pressed')).toBe('false');
  });

  it('Sistema resolves through matchMedia and follows live changes only while selected', () => {
    mount();
    act(() => radios()[0].click());
    expect(localStorage.getItem('ogs-base')).toBe('sistema');
    expect(html.getAttribute('data-base')).toBe('atlas');
    light = true;
    act(() => listeners.forEach((l) => l()));
    expect(html.getAttribute('data-base')).toBe('claro');
    light = false;
    act(() => listeners.forEach((l) => l()));
    expect(html.getAttribute('data-base')).toBe('atlas');
    act(() => radios()[2].click());
    light = true;
    act(() => listeners.forEach((l) => l()));
    expect(html.getAttribute('data-base')).toBe('grafito');
    act(() => root.unmount());
    expect(listeners).toHaveLength(0);
    root = createRoot(host);
  });

  it('does not break when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    mount();
    expect(radios().find((b) => b.getAttribute('aria-checked') === 'true')?.textContent).toBe('Atlas');
    act(() => radios()[4].click());
    act(() => swatches()[2].click());
    expect(html.getAttribute('data-accent')).toBe('violeta');
    expect(readTheme().base).toBe('atlas');
  });

  it('ignores invalid stored values', () => {
    localStorage.setItem('ogs-base', 'neon');
    localStorage.setItem('ogs-accent', 'red');
    expect(readTheme()).toEqual({ base: 'atlas', accent: 'lima' });
    mount();
    expect(radios().filter((b) => b.getAttribute('aria-checked') === 'true')).toHaveLength(1);
  });

  it('keeps the preference out of the store and the persisted state', () => {
    setBase('claro');
    setAccent('azul');
    expect(Object.keys(localStorage).sort()).toEqual(['ogs-accent', 'ogs-base']);
  });
});

describe('pre-paint script and src/lib/theme.ts agree', () => {
  const script = /<script>([\s\S]*?)<\/script>/.exec(readFileSync('index.html', 'utf8'))?.[1] ?? '';
  const baseInputs = [...BASE_CHOICES, 'neon', 'Claro', '', null];
  const accentInputs = [...ACCENT_CHOICES, 'pink', '#fff', null];
  for (const dark of [false, true]) {
    it(`same attributes for every stored pair (${dark ? 'dark' : 'light'} system)`, () => {
      light = !dark;
      for (const b of baseInputs) for (const a of accentInputs) {
        localStorage.clear();
        if (b !== null) localStorage.setItem('ogs-base', b);
        if (a !== null) localStorage.setItem('ogs-accent', a);
        const got: Record<string, string> = {};
        new Function('document', 'localStorage', 'matchMedia', script)({ documentElement: { setAttribute: (k: string, v: string) => (got[k] = v) } }, localStorage, matchMedia);
        applyTheme();
        expect({ 'data-base': html.getAttribute('data-base'), 'data-accent': html.getAttribute('data-accent') }, `${b}/${a}`).toEqual(got);
      }
    });
  }
  it('uses the same storage keys', () => {
    expect(script).toContain("'ogs-base'");
    expect(script).toContain("'ogs-accent'");
  });
});
