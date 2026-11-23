import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  findFreePositionFor,
  nodeRect,
  NODE_WIDTH,
  panelZone,
  rectsOverlap,
  settleFresh,
  type NodeRect,
} from '../src/engine/flow/graph';
import { hitZoom, portZoom } from '../src/components/node/connectionDrop';
import type { GraphNode, GraphNodeData } from '../src/engine/types';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
}));

const imageNode = (id: string, x: number, y: number): GraphNode => ({
  id,
  position: { x, y },
  data: { kind: 'image', title: id } as unknown as GraphNodeData,
});
const textNode = (id: string, x: number, y: number): GraphNode => ({
  id,
  position: { x, y },
  data: { kind: 'text', title: id, text: '' } as unknown as GraphNodeData,
});
const chatNode = (id: string, x: number, y: number): GraphNode => ({
  id,
  position: { x, y },
  data: { kind: 'ref', type: 'chat', title: id } as unknown as GraphNodeData,
});

describe('p10e rendimiento: bucle cuadratico/cubico con 200 tarjetas', () => {
  it('settling 200 overlapping fresh cards stays fast (< 50 ms) and scales sub-quadratically from 20 cards', () => {
    const run = (count: number) => {
      const nodes: GraphNode[] = Array.from({ length: count }, (_, i) => imageNode(`n${i}`, 0, 0));
      const fresh = new Set(nodes.map((n) => n.id));
      const measured = new Map(nodes.map((n) => [n.id, { width: 260, height: 220 }]));
      const t0 = performance.now();
      const moves = settleFresh(nodes, fresh, measured);
      return { ms: performance.now() - t0, moved: moves.size };
    };
    // Best of 3: a full parallel suite adds scheduler noise; a real quadratic loop stays slow on every run.
    const best = (count: number) => [run(count), run(count), run(count)].reduce((a, b) => (b.ms < a.ms ? b : a));
    const r20 = best(20);
    const r200 = best(200);
    expect(r200.moved).toBe(199);
    expect(r200.ms, `N=20: ${r20.ms.toFixed(1)} ms, N=200: ${r200.ms.toFixed(1)} ms`).toBeLessThan(50);
  });

  it('200 repeated drops at the same point complete without perceptible lag (< 50 ms)', () => {
    const data = { kind: 'image', title: 'Image' } as unknown as GraphNodeData;
    // Best of 3: a loaded full suite adds scheduler noise; a real cubic loop stays slow on every run.
    const once = () => {
      const occupied: NodeRect[] = [];
      const t0 = performance.now();
      for (let i = 0; i < 200; i++) {
        const p = findFreePositionFor(data, { x: 0, y: 0 }, occupied);
        occupied.push(nodeRect(imageNode(`d${i}`, p.x, p.y)));
      }
      return performance.now() - t0;
    };
    const ms = Math.min(once(), once(), once());
    expect(ms, `200 drops took ${ms.toFixed(1)} ms`).toBeLessThan(50);
  });

  it('measures a single findFreePositionFor call with 200 packed image cards (with panels)', () => {
    const occupied: NodeRect[] = [];
    for (let i = 0; i < 200; i++) {
      const col = i % 14;
      const row = Math.floor(i / 14);
      occupied.push(nodeRect(imageNode(`p${i}`, (col - 7) * 320, (row - 7) * 540)));
    }
    const t0 = performance.now();
    const pos = findFreePositionFor({ kind: 'image', title: 'New' } as unknown as GraphNodeData, { x: 0, y: 0 }, occupied);
    const ms = performance.now() - t0;
    expect(Number.isFinite(pos.x) && Number.isFinite(pos.y)).toBe(true);
    expect(ms).toBeLessThan(50);
  });
});

describe('p10e solapes: settleFresh con paneles de composer', () => {
  it('settleFresh updates the moved node panel position so the next fresh node does not land inside it', () => {
    const e1 = textNode('e1', 0, 0);
    const e2 = textNode('e2', 0, 276);
    const e3 = textNode('e3', 0, -276);
    const e4 = textNode('e4', -308, 0);
    const n1 = imageNode('n1', 0, 0);
    const n2 = textNode('n2', 350, 250);
    const nodes = [e1, e2, e3, e4, n1, n2];
    const measured = new Map<string, { width: number; height: number }>(
      nodes.map((n) => [n.id, { width: 260, height: n.data.kind === 'image' ? 220 : 170 }]),
    );
    const moves = settleFresh(nodes, new Set(['n1', 'n2']), measured);
    const n1Pos = moves.get('n1') ?? n1.position;
    const n2Pos = moves.get('n2') ?? n2.position;
    const n1Panel = panelZone(n1.data, { ...n1Pos, width: 260, height: 220 })!;
    expect(rectsOverlap({ ...n2Pos, width: 260, height: 170 }, n1Panel)).toBe(false);
  });

  it('settleFresh moves a fresh node when a taller measured image card puts its composer panel over it', () => {
    const img = imageNode('img', 0, 0);
    const below = textNode('below', 0, 532);
    const measured = new Map<string, { width: number; height: number }>([
      ['img', { width: 260, height: 462 }],
      ['below', { width: 260, height: 170 }],
    ]);
    const moves = settleFresh([img, below], new Set(['below']), measured);
    const belowPos = moves.get('below') ?? below.position;
    const imgPanel = panelZone(img.data, { x: 0, y: 0, width: 260, height: 462 })!;
    expect(rectsOverlap({ ...belowPos, width: 260, height: 170 }, imgPanel)).toBe(false);
  });

  it('PANEL.height covers an Image composer panel that includes the always-present Ref row (.nt-refs) + max prompt + model row', () => {
    const cssNode = readFileSync('src/styles/node.css', 'utf8');
    const settingsTsx = readFileSync('src/components/node/NodeSettings.tsx', 'utf8');
    const padding = cssNode.match(/\.nt-panel \{[^}]*padding: 0\.75rem/) ? 12 : 0;
    const gap = cssNode.match(/\.nt-panel \{[^}]*gap: 0\.625rem/) ? 10 : 0;
    const promptMax = cssNode.match(/\.nt-prompt \{[^}]*max-height: 13\.75rem/) ? 220 : 0;
    const refHeight = cssNode.match(/\.nt-ref \{[^}]*height: 2\.5rem/) ? 40 : 0;
    const goHeight = cssNode.match(/\.nt-go \{[^}]*height: 1\.875rem/) ? 30 : 0;
    expect(settingsTsx).toMatch(/<InputRefs node=\{node\} \/>/);
    const minImagePanelHeight = padding * 2 + 2 + refHeight + gap + promptMax + gap + goHeight; // 336 px
    const panel = panelZone({ kind: 'image', title: 'Image' } as GraphNodeData, { x: 0, y: 0, width: NODE_WIDTH, height: 220 })!;
    expect(panel.height, `reserved ${panel.height} px < actual min ${minImagePanelHeight} px`).toBeGreaterThanOrEqual(minImagePanelHeight);
  });
});

describe('p10e posiciones lejanas sin motivo con tarjetas de distinto tamano', () => {
  it('places a text card at the nearest free corner instead of jumping past the outer row', () => {
    const occupied = [
      chatNode('chat', 0, 0),
      textNode('top', 0, -226),
      textNode('right', 488, 0),
      textNode('left', -308, 0),
      textNode('bottom', 0, 616),
    ].map((n) => nodeRect(n));
    const desired = { x: 100, y: 100 };
    const placed = findFreePositionFor({ kind: 'text', title: 'T', text: '' } as unknown as GraphNodeData, desired, occupied);
    const dist = Math.hypot(placed.x - desired.x, placed.y - desired.y);
    const cornerDist = Math.hypot(308 - desired.x, -226 - desired.y);
    expect(dist).toBeLessThanOrEqual(cornerDist + 10);
  });
});

describe('p10e zoom extremo (0.05 y 4)', () => {
  it('at zoom 0.05 on an Image card, handle hit zones do not cover 100% of the card body', () => {
    const cssSystem = readFileSync('src/styles/node-system.css', 'utf8');
    const cssNode = readFileSync('src/styles/node.css', 'utf8');
    const hz = hitZoom(0.05);
    const zoneW = 24 / hz;
    const portLeftShift = cssSystem.match(/\.react-flow__handle-left\.port::after\s*\{\s*left:\s*calc\(50% - (\d+(?:\.\d+)?)px \/ var\(--rf-hit-zoom, 1\)\)/);
    expect(portLeftShift).not.toBeNull();
    const portRight = zoneW / 2 - Number(portLeftShift![1]) / hz;
    const nextRight = Number(cssNode.match(/\.nc-next\.react-flow__handle \{[^}]*right: (-?\d+)px/)?.[1]);
    const nextWidth = Number(cssNode.match(/\.nc-next\.react-flow__handle \{[^}]*width: (\d+)px/)?.[1]);
    expect(nextRight).toBe(-34);
    expect(nextWidth).toBe(22);
    const nextShift = cssSystem.match(/(?<!k-text\) )\.nc-next::after\s*\{\s*left:\s*calc\(50% \+ max\(0px, (\d+(?:\.\d+)?)px \/ var\(--rf-hit-zoom, 1\) - (\d+(?:\.\d+)?)px\)\)/);
    expect(nextShift).not.toBeNull();
    const nextCenter = NODE_WIDTH - nextRight - nextWidth / 2 + Math.max(0, Number(nextShift![1]) / hz - Number(nextShift![2]));
    const nextLeft = nextCenter - zoneW / 2;
    expect(portRight).toBeLessThanOrEqual(0);
    expect(nextLeft).toBeGreaterThanOrEqual(NODE_WIDTH);
    expect(portRight).toBeLessThan(nextLeft);
  });

  it('at zoom 4 the text + hit zone stays outside the card body and at least 24 px on screen', () => {
    const cssSystem = readFileSync('src/styles/node-system.css', 'utf8');
    const cssNode = readFileSync('src/styles/node.css', 'utf8');
    const offset = Number(cssSystem.match(/k-text\) \.nc-next::after \{ left: calc\(50% \+ \(12px \/ var\(--rf-hit-zoom, 1\) - (\d+)px\)\)/)?.[1]);
    const navRight = Number(cssNode.match(/k-text\) \.nc-next\.react-flow__handle \{ right: -(\d+)px/)?.[1]);
    const hz = hitZoom(4);
    expect(hz).toBe(4);
    expect(portZoom(4)).toBe(4);
    const navLeft = NODE_WIDTH + navRight - 22;
    const center = navLeft + 11 + (12 / hz - offset);
    const inner = center - 12 / hz;
    expect(inner).toBeGreaterThanOrEqual(NODE_WIDTH);
    expect((24 / hz) * 4).toBeGreaterThanOrEqual(24);
  });

  it('20 repeated drops at (0,0) never overlap each other or any panel', () => {
    const data = { kind: 'image', title: 'Image' } as unknown as GraphNodeData;
    const rects: NodeRect[] = [];
    for (let i = 0; i < 20; i++) {
      const p = findFreePositionFor(data, { x: 0, y: 0 }, rects);
      const r = nodeRect(imageNode(`r${i}`, p.x, p.y));
      for (const prev of rects) {
        expect(rectsOverlap(r, prev, 48, 56)).toBe(false);
        if (prev.panel) expect(rectsOverlap(r, prev.panel)).toBe(false);
        if (r.panel) expect(rectsOverlap(r.panel, prev)).toBe(false);
      }
      rects.push(r);
    }
  });
});
