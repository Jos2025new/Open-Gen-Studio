import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { OPS, OP_IDS } from '../src/engine/ops';
import { OP_GROUPS, OP_GROUP_ORDER, opGroup } from '../src/components/assets/opGroups';

const panel = readFileSync('src/components/node/SelectionPanel.tsx', 'utf8');
const ws = readFileSync('src/components/node/NodeWorkspace.tsx', 'utf8');
const nodes = readFileSync('src/components/node/nodes.tsx', 'utf8');

it('every op with one input has its own section, in Explore · Edit · Reuse · Finalize order', () => {
  const single = OP_IDS.filter((id) => !OPS[id].multiInput);
  expect(single.filter((id) => !(id in OP_GROUPS))).toEqual([]);
  expect(OP_GROUP_ORDER).toEqual(['explore', 'edit', 'reuse', 'finalize']);
  expect(opGroup('upscale')).toBe('finalize');
  expect(opGroup('variations')).toBe('explore');
  expect(opGroup('remove_bg')).toBe('edit');
});

it('the full canvas shows the Selection panel at the top right for exactly one selected node; Studio’s board does not', () => {
  expect(panel).toMatch(/<Panel position="top-right" className="selection-panel/);
  expect(ws).toMatch(/\{embedded \? null : <CanvasPanels sessionId=\{sessionId\}/);
  expect(panel).toMatch(/nodes\.length === 1 \? <SelectionPanel/);
  expect(ws).toMatch(/data: \{ node: n, solo, panel: !embedded \}/);
});

it('the panel keeps every tool the node bar had: all single-input ops for the result, Panorama, Sketch, Attach to prompt, Download', () => {
  expect(panel).toMatch(/OP_IDS\.filter\(\(op\) => !OPS\[op\]\.multiInput && OPS\[op\]\.input === out\)/);
  for (const label of ["'Panorama'", "'Sketch'", "'Attach to prompt'", "'Download'"]) expect(panel).toContain(label);
  expect(panel).toMatch(/addConnected\(sessionId, node\.id/);
});

it('with the panel, the node bar keeps Run, outputs, Open, Reset image, Duplicate and Delete; without it (Studio’s board) the tools stay in the bar', () => {
  const bar = nodes.slice(nodes.indexOf('function NodeActions'), nodes.indexOf('function ParamSelect'));
  expect(bar).toMatch(/const quick = assetId && out && !panel \?/);
  expect(bar).toMatch(/\{assetId && out && !panel \? <MoreTools/);
  expect(bar).toMatch(/out === 'image' && !panel \?/);
  expect(bar).toMatch(/\{panel \? null : \(/);
  for (const kept of ['<RunButton', 'aria-label="Open"', 'Reset image', 'aria-label="Duplicate"', '<DeleteButton']) expect(bar).toContain(kept);
});
