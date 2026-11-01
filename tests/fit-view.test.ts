// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { fitView } from '../src/components/designer/fitView';

it('Fit canvas centers the canvas in the stage, the room the pinned right panel leaves', () => {
  const v = fitView({ w: 1300, h: 900 }, { width: 1000, height: 1000 });
  expect(v.x + (1000 * v.zoom) / 2).toBeCloseTo(650);
  expect(v.zoom).toBeCloseTo((900 - 24 - 120) / 1000);
});

it('the prompt box is centered on that same line: the stage, not the whole workspace', () => {
  const css = readFileSync('src/styles/tool-dock.css', 'utf8');
  expect(css).toMatch(/\.ws-designer \.dock-designer \{ left: calc\(\(100% - var\(--layers-w, 0px\)\) \/ 2\); transform: translateX\(-50%\);/);
  expect(css).toMatch(/\.ws-designer \.dock-designer:has\(\.composer-tools-bar\) \{ width: max-content; max-width: calc\(100% - var\(--layers-w, 0px\) - 48px\); \}/);
  // A peeking panel floats over: only a pinned panel sets the width the box centers against.
  expect(readFileSync('src/components/designer/LayersPanel.tsx', 'utf8')).toContain("root.setProperty('--layers-w', collapsed ? '0px' : `${width}px`);");
  expect(readFileSync('src/components/designer/Stage.tsx', 'utf8')).toContain('fitView(size, doc, board)');
});
