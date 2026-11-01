// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PanelPeekHandle, usePanelPeek } from '../src/components/designer/LayersPeek';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** The same wiring as LayersPanel: unpinned shows the handle until it peeks; the panel carries the peek props. */
function Harness() {
  const [unpinned, setUnpinned] = useState(true);
  const peek = usePanelPeek(unpinned);
  if (unpinned && !peek.on) return createElement(PanelPeekHandle, { warn: false, onPin: () => setUnpinned(false), show: peek.show, hide: peek.hide });
  return createElement('aside', { className: `layers-panel${peek.on ? ' is-peek' : ''}`, ...peek.panelProps }, createElement('button', { 'aria-label': unpinned ? 'Pin layers panel' : 'Collapse layers panel', onClick: () => setUnpinned(!unpinned) }));
}

it('unpinned: hovering the corner icon peeks the panel; leaving hides it after a pause; clicking pins it', () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(Harness)));
  const icon = () => host.querySelector<HTMLButtonElement>('.layers-peek-handle [aria-label="Pin layers panel"]');
  expect(icon()).not.toBeNull();
  expect(host.querySelector('.layers-panel')).toBeNull();
  act(() => { icon()!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
  expect(host.querySelector('.layers-panel.is-peek')).not.toBeNull();
  act(() => { host.querySelector('.layers-panel')!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); });
  expect(host.querySelector('.layers-panel.is-peek')).not.toBeNull();
  act(() => { vi.advanceTimersByTime(300); });
  expect(host.querySelector('.layers-panel')).toBeNull();
  act(() => icon()!.click());
  expect(host.querySelector('.layers-panel')?.className).toBe('layers-panel');
  act(() => root.unmount()); host.remove();
});

it('the right panel uses it with no empty strip: unpinned takes no width, peeks in its pinned width, the header pin toggles', () => {
  const panel = readFileSync('src/components/designer/LayersPanel.tsx', 'utf8');
  expect(panel).toMatch(/const peek = usePanelPeek\(collapsed\);/);
  expect(panel).toMatch(/if \(collapsed && !peek\.on\) return <PanelPeekHandle warn=\{!!pendingPaintLayer\} onPin=\{\(\) => setCollapsed\(false\)\} show=\{peek\.show\} hide=\{peek\.hide\} \/>;/);
  expect(panel).toMatch(/root\.setProperty\('--layers-w', collapsed \? '0px' : `\$\{width\}px`\);\s*root\.setProperty\('--layers-peek-w', `\$\{width\}px`\);/);
  expect(panel).toMatch(/\$\{peek\.on \? ' is-peek' : ''\}`\} aria-label="Layers" \{\.\.\.peek\.panelProps\}>/);
  expect(panel).toMatch(/label=\{collapsed \? 'Pin layers panel' : 'Collapse layers panel'\} size="sm" onClick=\{\(\) => setCollapsed\(!collapsed\)\}/);
  expect(panel).not.toContain('is-collapsed');
  expect(readFileSync('src/styles/layers-peek.css', 'utf8')).toMatch(/\.layers-panel\.is-peek \{ position: absolute;[^}]*width: var\(--layers-peek-w, 260px\);/);
});
