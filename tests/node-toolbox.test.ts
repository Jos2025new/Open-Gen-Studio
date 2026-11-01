import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const nav = readFileSync('src/components/node/CanvasNavigation.tsx', 'utf8');
const ws = readFileSync('src/components/node/NodeWorkspace.tsx', 'utf8');

it('Nodes has one vertical canvas toolbox with every canvas tool, in order (Auto layout under Pan, Delete with Undo and Redo), its popovers opening to the right', () => {
  expect(nav).toMatch(/<Panel position="top-left" className="canvas-navigation" role="toolbar" aria-label="Canvas tools" aria-orientation="vertical">/);
  const panel = nav.slice(nav.indexOf('<Panel position'), nav.indexOf('</Panel>'));
  const order = ['{add ?', 'MousePointer2', 'icon={Hand}', 'icon={LayoutDashboard}', 'label="Fit view" disabled', 'icon={Map}', 'icon={Undo2}', 'icon={Redo2}', 'icon={Trash}', 'label="Zoom in"', 'canvas-zoom num', 'label="Zoom out"', 'label="Search canvas"'].map((t) => panel.indexOf(t));
  expect(order.every((i) => i > 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(nav.match(/placement="right-start"/g)).toHaveLength(3);
  expect(readFileSync('src/styles/node.css', 'utf8')).toMatch(/\.canvas-navigation \{[^}]*flex-direction: column;[^}]*border: 1px solid var\(--panel-line\); border-radius: var\(--toolbar-radius\)/);
});

it('the top bar keeps only Run all; Add node, Auto layout and Fit view live in the toolbox', () => {
  const top = ws.slice(ws.indexOf('<TopbarActions>'), ws.indexOf('</TopbarActions>'));
  expect(top).toContain('<RunAll');
  expect(top).not.toMatch(/AddNodeMenu|Auto layout|Fit view/);
  expect(ws).toMatch(/add=\{<AddNodeMenu onAdd=\{addAtCenter\} onImport=\{importAtCenter\} \/>\}/);
  expect(ws).toMatch(/<IconButton ref=\{pop\.ref\} icon=\{Plus\} label="Add node"/);
});

it('Nodes zooms as far as the Designer, and the zoom popover uses the app’s one slider (log scale, typed percent), no Fit view', () => {
  expect(nav).toMatch(/NODE_MIN_ZOOM = 0\.05/);
  expect(nav).toMatch(/NODE_MAX_ZOOM = MAX_ZOOM/);
  expect(ws).toMatch(/minZoom=\{NODE_MIN_ZOOM\}\s*maxZoom=\{NODE_MAX_ZOOM\}/);
  const pop = nav.slice(nav.indexOf('function ZoomControls'), nav.indexOf('function Highlight'));
  expect(pop).toMatch(/<InlineSlider label="Zoom"[^>]* log /);
  expect(pop).not.toMatch(/<Range|type="range"/);
  expect(pop).not.toMatch(/Fit view|Maximize/);
  const popover = nav.slice(nav.indexOf('<Popover open={zoomPop.open}'), nav.indexOf('<Popover open={searchPop.open}'));
  expect(popover).toContain('<ZoomControls');
  expect(popover).not.toMatch(/Fit view|fitView/);
});
