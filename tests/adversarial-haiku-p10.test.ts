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
  // reproduce: Image existente con su panel bajo la tarjeta; el hueco bajo ella está ocupado, así que el Text nuevo cae a su lado (x -308) dentro del panel; findFreePositionFor solo reserva el panel del nodo nuevo
  it.fails('a new Text card is not placed under the composer panel of an existing Image card', () => {
    const image = card(IMAGE, 0, 0);
    const blocker = card(VIDEO, 0, 466);
    const at = findFreePositionFor(TEXT, { x: 0, y: 240 }, [image, blocker]);
    const textRect = { ...at, width: 260, height: 170 };
    const imagePanel = panelZone(IMAGE, image)!;
    expect(rectsOverlap(imagePanel, textRect), `text at ${JSON.stringify(at)} sits under the Image composer`).toBe(false);
  });

  // reproduce: deseado NaN (p. ej. un puntero sin medir) se devuelve tal cual en lugar de una posición finita
  it.fails('a non-finite desired position still gives a finite placement', () => {
    const at = findFreePositionFor(IMAGE, { x: Number.NaN, y: 0 }, []);
    expect(Number.isFinite(at.x) && Number.isFinite(at.y)).toBe(true);
  });

  // reproduce: lienzo bloqueado (ningún hueco en el anillo) más un nodo importado con y NaN; el fallback usa max() y devuelve y NaN
  it.fails('an existing node with a NaN position does not make the fallback position NaN', () => {
    const block: NodeRect = { x: -1e6, y: -1e6, width: 2e6, height: 2e6 };
    const broken: NodeRect = { x: 0, y: Number.NaN, width: 260, height: 220 };
    const at = findFreePositionFor(IMAGE, { x: 0, y: 0 }, [block, broken]);
    expect(Number.isFinite(at.x) && Number.isFinite(at.y)).toBe(true);
  });
});

describe('adversarial p10: the + button path', () => {
  // reproduce: addConnected sin posición pone el nodo en x+360 sin findFreePositionFor; una tarjeta ya puesta en ese hueco queda solapada
  it.fails('a node added with the + button beside a card does not land on that card', () => {
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
  // reproduce: .port-quiet oculta con pointer-events none, pero .port::after fija pointer-events:auto y gana al heredado; el puerto invisible sigue recibiendo clic
  it.fails('a quiet port (opacity 0, pointer-events none) keeps no clickable 24 px zone', () => {
    expect(systemCss + nodeCss).toMatch(/\.port-quiet::after\s*\{[^}]*pointer-events:\s*none/);
  });

  // reproduce: .nc-next con right:-18px en tarjetas de texto mide 22 px; su zona de 24 px centrada entra 5 px en el cuerpo de la tarjeta
  it.fails('the 24 px zone of a text card connection handle does not reach into the card body', () => {
    const right = Number(nodeCss.match(/k-text\) \.nc-next\.react-flow__handle \{ right: (-?\d+)px/)?.[1]);
    const width = Number(nodeCss.match(/\.nc-next\.react-flow__handle \{[^}]*width: (\d+)px/)?.[1]);
    expect(Number.isFinite(right) && Number.isFinite(width)).toBe(true);
    // x grows to the right; the card's right edge is x = 0. The handle's right edge is at x = -right (CSS right is negative = outside).
    // Its centre is width/2 further in, and the 24 px zone extends 12 px either side of that centre.
    const zoneLeft = -right - width / 2 - 12;
    expect(zoneLeft).toBeGreaterThanOrEqual(0);
  });

  // reproduce: en el lienzo normal --rf-zoom no se define (usePortZoom solo actúa si omni); la zona es 24 px de flujo, así que con zoom 0.5 mide 12 px en pantalla
  it.fails('the 24 px zone is 24 px on screen on the plain canvas (--rf-zoom is only set on the omnicanvas)', () => {
    const connectionDrop = css('src/components/node/connectionDrop.ts');
    expect(connectionDrop).not.toMatch(/if \(omni\) canvas\.current\?\.style\.setProperty\('--rf-zoom'/);
  });
});
