// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PanelPeekHandle, usePanelPeek } from '../src/components/designer/LayersPeek';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** The same wiring as LayersPanel: unpinned shows the bar of tabs; peeking adds the panel; a tab click pins it on that tab. */
function Harness() {
  const [unpinned, setUnpinned] = useState(true);
  const [tab, setTab] = useState<'props' | 'tool' | 'layers'>('props');
  const peek = usePanelPeek(unpinned);
  const handle = unpinned && createElement(PanelPeekHandle, { warn: false, tab: peek.on ? tab : null, onTab: (id, pin) => { setTab(id); if (pin) setUnpinned(false); }, show: peek.show, hide: peek.hide });
  if (unpinned && !peek.on) return handle;
  return createElement('div', null, handle, createElement('aside', { className: `layers-panel${peek.on ? ' is-peek' : ''}`, 'data-tab': tab, ...peek.panelProps }));
}

it('unpinned: the tabs stand in a vertical bar; hovering one peeks the panel on it, leaving hides it, clicking pins it there', () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(Harness)));
  const bar = () => host.querySelector('.layers-peek-handle');
  const tab = (name: string) => host.querySelector<HTMLButtonElement>(`.layers-peek-handle [aria-label="${name} · click to pin"]`)!;
  expect(bar()?.getAttribute('aria-orientation')).toBe('vertical');
  expect([...bar()!.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Properties · click to pin', 'Tool · click to pin', 'Layers · click to pin']);
  expect(host.querySelector('.layers-panel')).toBeNull();
  act(() => { tab('Tool').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
  expect(host.querySelector('.layers-panel.is-peek')?.getAttribute('data-tab')).toBe('tool');
  expect(tab('Tool').getAttribute('aria-pressed')).toBe('true');
  expect(bar()).not.toBeNull();
  act(() => { host.querySelector('.layers-panel')!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); });
  act(() => { vi.advanceTimersByTime(300); });
  expect(host.querySelector('.layers-panel')).toBeNull();
  expect(tab('Tool').getAttribute('aria-pressed')).toBe('false');
  act(() => tab('Layers').click());
  expect(host.querySelector('.layers-panel')?.className).toBe('layers-panel');
  expect(host.querySelector('.layers-panel')?.getAttribute('data-tab')).toBe('layers');
  expect(bar()).toBeNull();
  act(() => root.unmount()); host.remove();
});

it('the right panel uses it with no empty strip: unpinned takes no width, peeks beside the bar in its pinned width, the header pin toggles', () => {
  const panel = readFileSync('src/components/designer/LayersPanel.tsx', 'utf8');
  expect(panel).toMatch(/const peek = usePanelPeek\(collapsed\);/);
  expect(panel).toMatch(/const handle = collapsed && <PanelPeekHandle warn=\{!!pendingPaintLayer\} tab=\{peek\.on \? tab : null\} onTab=\{\(id, pin\) => \{ setTab\(id\); if \(pin\) setCollapsed\(false\); \}\} show=\{peek\.show\} hide=\{peek\.hide\} \/>;\s*if \(collapsed && !peek\.on\) return handle;/);
  expect(panel).toMatch(/return <>\{handle\}<aside className=\{`layers-panel/);
  expect(panel).toMatch(/root\.setProperty\('--layers-w', collapsed \? '0px' : `\$\{width\}px`\);\s*root\.setProperty\('--layers-peek-w', `\$\{width\}px`\);/);
  expect(panel).toMatch(/\$\{peek\.on \? ' is-peek' : ''\}`\} aria-label="Layers" \{\.\.\.peek\.panelProps\}>/);
  expect(panel).toMatch(/label=\{collapsed \? 'Pin layers panel' : 'Collapse layers panel'\} size="sm" onClick=\{\(\) => setCollapsed\(!collapsed\)\}/);
  expect(panel).not.toContain('is-collapsed');
  expect(readFileSync('src/styles/layers-peek.css', 'utf8')).toMatch(/\.layers-panel\.is-peek \{ position: absolute; z-index: 30; top: 12px; right: calc\(12px \+ var\(--control-h\) \+ 2 \* var\(--toolbar-padding\) \+ 2px \+ var\(--canvas-pop-gap\)\);[^}]*width: var\(--layers-peek-w, 260px\);/);
});

it('pinning or unpinning the panel resizes the canvas but keeps the user\'s zoom: only a new document or an untouched view refits', () => {
  const stage = readFileSync('src/components/designer/Stage.tsx', 'utf8');
  expect(stage).toMatch(/setView\(\(untouched\.current = \{ zoom: z,/);
  expect(stage).toMatch(/const key = `\$\{doc\.id\}:\$\{doc\.width\}x\$\{doc\.height\}`;\s*if \(size\.w && \(fitted\.current !== key \|\| view === untouched\.current\)\) \{/);
});
