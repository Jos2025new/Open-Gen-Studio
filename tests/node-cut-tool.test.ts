import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { segmentsCross, trailCuts } from '../src/components/node/CutTool';
import { shortcutGroups } from '../src/engine/shortcuts';

const nav = readFileSync('src/components/node/CanvasNavigation.tsx', 'utf8');
const ws = readFileSync('src/components/node/NodeWorkspace.tsx', 'utf8');

describe('Nodes Cut tool (scissors)', () => {
  it('a trail cuts only the connections it crosses', () => {
    expect(segmentsCross({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true);
    expect(segmentsCross({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toBe(false);
    expect(segmentsCross({ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 6, y: 0 }, { x: 10, y: -4 })).toBe(false);
    const lines = [
      { id: 'a', points: [{ x: 0, y: 10 }, { x: 50, y: 12 }, { x: 100, y: 10 }] },
      { id: 'b', points: [{ x: 0, y: 80 }, { x: 100, y: 80 }] },
    ];
    expect(trailCuts([{ x: 40, y: 0 }, { x: 45, y: 30 }], lines)).toEqual(['a']);
    expect(trailCuts([{ x: 40, y: 0 }, { x: 42, y: 50 }, { x: 45, y: 100 }], lines)).toEqual(['a', 'b']);
    expect(trailCuts([{ x: 40, y: 30 }, { x: 60, y: 60 }], lines)).toEqual([]);
  });

  it('sits in the toolbox after Pan, takes X, is not remembered, and cuts through disconnectEdges (one undo step)', () => {
    const panel = nav.slice(nav.indexOf('<Panel position'), nav.indexOf('</Panel>'));
    expect(panel.indexOf('icon={Scissors}')).toBeGreaterThan(panel.indexOf('icon={Hand}'));
    expect(panel.indexOf('icon={Scissors}')).toBeLessThan(panel.indexOf('icon={LayoutDashboard}'));
    expect(panel).toMatch(/label="Cut connections \(X\)/);
    expect(ws).toMatch(/if \(k === 'x'\) \{ e\.preventDefault\(\); pickTool\(tool === 'cut' \? lastTool\.current : 'cut'\); \}/);
    expect(ws).toMatch(/if \(t === 'cut'\) return; lastTool\.current = t; try \{ localStorage/);
    expect(ws).toMatch(/useCutTool\(\{ active: tool === 'cut', canvasRef, onCut: \(ids\) => void disconnectEdges\(sessionId, ids\) \}\)/);
    expect(ws).toMatch(/panOnDrag=\{tool === 'pan' \? true : \[1, 2\]\}/);
    expect(shortcutGroups().find((g) => g.title === 'Nodes')?.items.some((i) => i.keys === 'X')).toBe(true);
  });
});
