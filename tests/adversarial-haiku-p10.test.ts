import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { GraphNode, GraphNodeData } from '../src/engine/types';
import { findFreePositionFor, nodeRect, panelZone, rectsOverlap, type NodeRect } from '../src/engine/flow/graph';
import { addConnected } from '../src/engine/flow/actions';
import { createSession, useStore } from '../src/store/store';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
}));

const card = (data: GraphNodeData, x: number, y: number): NodeRect => nodeRect({ id: 'x', position: { x, y }, data } as GraphNode);
const IMAGE = { kind: 'image', title: 'Image' } as GraphNodeData;
const VIDEO = { kind: 'video', title: 'Video' } as GraphNodeData;
const TEXT = { kind: 'text', title: 'Text', text: '' } as GraphNodeData;

const css = (f: string) => readFileSync(f, 'utf8');
const nodeCss = css('src/styles/node.css');
const systemCss = css('src/styles/node-system.css');

describe('adversarial p10: placement of new nodes', () => {
  it('a new Text card is not placed under the composer panel of an existing Image card', () => {
    const image = card(IMAGE, 0, 0);
    const blocker = card(VIDEO, 0, 466);
    const at = findFreePositionFor(TEXT, { x: 0, y: 240 }, [image, blocker]);
    const textRect = { ...at, width: 260, height: 170 };
    const imagePanel = panelZone(IMAGE, image)!;
    expect(rectsOverlap(imagePanel, textRect), `text at ${JSON.stringify(at)} sits under the Image composer`).toBe(false);
  });

  it('a non-finite desired position still gives a finite placement', () => {
    const at = findFreePositionFor(IMAGE, { x: Number.NaN, y: 0 }, []);
    expect(Number.isFinite(at.x) && Number.isFinite(at.y)).toBe(true);
  });

  it('an existing node with a NaN position does not make the fallback position NaN', () => {
    const block: NodeRect = { x: -1e6, y: -1e6, width: 2e6, height: 2e6 };
    const broken: NodeRect = { x: 0, y: Number.NaN, width: 260, height: 220 };
    const at = findFreePositionFor(IMAGE, { x: 0, y: 0 }, [block, broken]);
    expect(Number.isFinite(at.x) && Number.isFinite(at.y)).toBe(true);
  });
});

describe('adversarial p10: the + button path', () => {
  it('a node added with the + button beside a card does not land on that card', () => {
    const session = createSession('adv-p10-plus');
    const src: GraphNode = { id: 'src', position: { x: 0, y: 0 }, data: TEXT };
    const blocker: GraphNode = { id: 'blk', position: { x: 360, y: 0 }, data: TEXT };
    useStore.setState((s) => ({ sessions: { ...s.sessions, [session.id]: { ...session, graph: { nodes: [src, blocker], edges: [] }, feed: [] } } }));
    const id = addConnected(session.id, 'src', IMAGE as GraphNodeData);
    const added = useStore.getState().sessions[session.id].graph.nodes.find((n) => n.id === id);
    expect(added, 'node added').toBeDefined();
    expect(rectsOverlap(nodeRect(added!), nodeRect(blocker))).toBe(false);
  });
});

describe('adversarial p10: click zones in node-system.css', () => {
  it('a quiet port (opacity 0, pointer-events none) keeps no clickable 24 px zone', () => {
    expect(systemCss + nodeCss).toMatch(/\.port-quiet::after\s*\{[^}]*pointer-events:\s*none/);
  });

  it('the 24 px zone of a text card connection handle does not reach into the card body', () => {
    const right = Number(nodeCss.match(/k-text\) \.nc-next\.react-flow__handle \{ right: (-?\d+)px/)?.[1]);
    const width = Number(nodeCss.match(/\.nc-next\.react-flow__handle \{[^}]*width: (\d+)px/)?.[1]);
    expect(Number.isFinite(right) && Number.isFinite(width)).toBe(true);
    // x grows to the right; the card's right edge is x = 0. The handle's right edge is at x = -right (CSS right is negative = outside).
    // Its centre is width/2 further in, and the 24 px zone extends 12 px either side of that centre.
    // The text-card rule in node-system.css shifts the zone centre: left: calc(50% + (12px / zoom - Npx)), read here at zoom 1.
    const shift = systemCss.match(/k-text\) \.nc-next::after \{ left: calc\(50% \+ \(12px \/ var\(--rf-zoom, 1\) - (\d+)px\)\)/);
    const zoneLeft = -right - width / 2 - 12 + (shift ? 12 - Number(shift[1]) : 0);
    expect(zoneLeft).toBeGreaterThanOrEqual(0);
  });

  it('the 24 px zone is 24 px on screen on the plain canvas', () => {
    const connectionDrop = css('src/components/node/connectionDrop.ts');
    expect(connectionDrop).not.toMatch(/if \(omni\) canvas\.current\?\.style\.setProperty\('--rf-zoom'/);
  });
});
