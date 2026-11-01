// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { fitView } from '../src/components/designer/fitView';

function stage(ws: { left: number; width: number }, own: { left: number; width: number }) {
  const host = document.createElement('div'); host.className = 'ws-designer';
  const el = document.createElement('div'); host.append(el); document.body.append(host);
  host.getBoundingClientRect = () => ({ ...ws, top: 0, height: 900 }) as DOMRect;
  el.getBoundingClientRect = () => ({ ...own, top: 0, height: 900 }) as DOMRect;
  return el;
}

it('Fit canvas centers on the workspace center, where the prompt box stays, and clears the right panel', () => {
  // Workspace 0–1600; the pinned right panel leaves the stage 0–1300. The canvas centers on 800 and fits in 2 × (500 − 24).
  const v = fitView(stage({ left: 0, width: 1600 }, { left: 0, width: 1300 }), { w: 1300, h: 900 }, { width: 1000, height: 1000 });
  expect(v.x + (1000 * v.zoom) / 2).toBeCloseTo(800);
  expect(1000 * v.zoom).toBeLessThanOrEqual(2 * (500 - 24) + 0.01);
  // Panel folded: same center, so the canvas does not jump.
  const folded = fitView(stage({ left: 0, width: 1600 }, { left: 0, width: 1600 }), { w: 1600, h: 900 }, { width: 1000, height: 1000 });
  expect(folded.x + (1000 * folded.zoom) / 2).toBeCloseTo(800);
});

it("Studio's embedded Designer centers on its own box", () => {
  const v = fitView(stage({ left: 0, width: 1600 }, { left: 900, width: 600 }), { w: 600, h: 900 }, { width: 100, height: 100 }, { bottom: 60 });
  expect(v.x + (100 * v.zoom) / 2).toBeCloseTo(300);
});

it('the prompt box stays at the workspace center in the Designer, narrowing evenly around the panels', () => {
  const css = readFileSync('src/styles/tool-dock.css', 'utf8');
  expect(css).toMatch(/\.ws-designer \.dock-designer \{ left: 50%; transform: translateX\(-50%\); width: min\(800px, calc\(100% - 2 \* max\(var\(--layers-w, 0px\), 84px\)/);
  expect(css).toMatch(/\.ws-designer \.dock-designer:has\(\.composer-tools-bar\) \{ width: max-content; max-width: calc\(100% - 2 \* var\(--layers-w, 0px\) - 48px\); \}/);
  expect(readFileSync('src/components/designer/Stage.tsx', 'utf8')).toContain('fitView(wrapRef.current, size, doc, board)');
});
