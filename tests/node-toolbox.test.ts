import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const nav = readFileSync('src/components/node/CanvasNavigation.tsx', 'utf8');
const ws = readFileSync('src/components/node/NodeWorkspace.tsx', 'utf8');

it('Nodes has one vertical canvas toolbox with every canvas tool, in order, its popovers opening to the right', () => {
  expect(nav).toMatch(/<Panel position="top-left" className="canvas-navigation" role="toolbar" aria-label="Canvas tools" aria-orientation="vertical">/);
  const panel = nav.slice(nav.indexOf('<Panel position'), nav.indexOf('</Panel>'));
  const order = ['{add ?', 'MousePointer2', 'icon={Hand}', 'icon={Trash}', 'LayoutGrid', 'label="Fit view" disabled', 'icon={Map}', 'icon={Undo2}', 'icon={Redo2}', 'label="Zoom in"', 'canvas-zoom num', 'label="Zoom out"', 'label="Search canvas"'].map((t) => panel.indexOf(t));
  expect(order.every((i) => i > 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(nav.match(/placement="right-start"/g)).toHaveLength(3);
  expect(readFileSync('src/styles/node.css', 'utf8')).toMatch(/\.canvas-navigation \{[^}]*flex-direction: column;[^}]*border: 1px solid var\(--panel-line\); border-radius: var\(--toolbar-radius\)/);
});

it('the top bar keeps only Run all; Add node, Auto layout and Fit view live in the toolbox', () => {
  const top = ws.slice(ws.indexOf('<TopbarActions>'), ws.indexOf('</TopbarActions>'));
  expect(top).toContain('<RunAll');
  expect(top).not.toMatch(/AddNodeMenu|Auto layout|Fit view/);
  expect(ws).toMatch(/add=\{<AddNodeMenu onAdd=\{addAtCenter\} \/>\}/);
  expect(ws).toMatch(/<IconButton ref=\{pop\.ref\} icon=\{Plus\} label="Add node"/);
});
