// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { fitView } from '../src/components/designer/fitView';

it('Fit canvas centers the canvas in the window', () => {
  const v = fitView({ w: 1300, h: 900 }, { width: 1000, height: 1000 });
  expect(v.x + (1000 * v.zoom) / 2).toBeCloseTo(650);
  expect(v.zoom).toBeCloseTo((900 - 24 - 120) / 1000);
});

it('a pinned panel leaves its margin on both sides, keeping the center', () => {
  document.documentElement.style.setProperty('--layers-w', '260px');
  const v = fitView({ w: 1300, h: 900 }, { width: 2000, height: 500 });
  document.documentElement.style.removeProperty('--layers-w');
  expect(v.x + (2000 * v.zoom) / 2).toBeCloseTo(650);
  expect(v.x).toBeCloseTo(260 + 12 + 24);
});

it('the prompt box is centered on that same line, narrowing to clear the panel', () => {
  const css = readFileSync('src/styles/tool-dock.css', 'utf8');
  expect(css).toMatch(/\.ws-designer \.dock-designer \{ left: 50%; transform: translateX\(-50%\);/);
  expect(css).toMatch(/\.ws-designer \.dock-designer:has\(\.composer-tools-bar\) \{ width: min\(800px, calc\(100% - 2 \* var\(--layers-w, 0px\) - 48px\)\); \}/);
  // A peeking panel floats over: only a pinned panel sets the width the box centers against.
  expect(readFileSync('src/components/designer/LayersPanel.tsx', 'utf8')).toContain("root.setProperty('--layers-w', collapsed ? '0px' : `${width}px`);");
  // Same width as the prompt box in Studio and Nodes (800 px): no jump when switching spaces or the toolbox's place.
  expect(css).toMatch(/\.composer-dock:has\(\.composer-tools-bar\) \{ width: min\(800px, calc\(100% - 48px\)\); \}\s*\.composer-dock \.composer:has\(\.composer-tools-bar\) \{ width: 100%; \}\s*\.composer-tools-bar \{ justify-content: space-between; \}/);
  expect(readFileSync('src/styles/prompt-box.css', 'utf8')).toContain('.composer-dock { width: min(800px, calc(100% - 48px)); }');
  expect(readFileSync('src/components/designer/Stage.tsx', 'utf8')).toContain('fitView(size, doc, board)');
});
