import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Omnicanvas UI (plan "todo es un nodo", step 12): the entry next to the Spaces, what leaves it, the node library entries
 * and the Space / chat cards. Static markup only; no app, no browser, no provider. */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from '@xyflow/react';
import { OMNI_ITEM, SPACES, openHome, openOmni, openSpace, openCreate, CREATE } from '../src/components/shell/navModel';
import { SidebarNav } from '../src/components/shell/SidebarNav';
import { NodeLibrary } from '../src/components/node/AddNodeItems';
import { SpaceNode } from '../src/components/omni/SpaceNode';
import { ChatNode } from '../src/components/omni/ChatNode';
import { omniWidth } from '../src/components/omni/RefNode';
import { ensureOmniNodes, omniSpaceNodeId, ordinaryGraph, setSpaceView } from '../src/engine/nodes/omni';
import { createSession, setUi, useStore } from '../src/store/store';

const ui = () => useStore.getState().ui;
let sid = '';
beforeEach(() => {
  const created = createSession('Omni UI');
  sid = created.id;
  useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: created }, activeSessionId: sid, assets: {} }));
  setUi({ omni: false, home: false, space: undefined, workspace: 'chat' });
});

describe('the entry to the omnicanvas', () => {
  it('sits in the Spaces section, after Studio, Canvas and Designer', () => {
    const html = renderToStaticMarkup(createElement(SidebarNav, { wide: true }));
    const at = (t: string) => html.indexOf(`>${t}<`);
    expect(at('Designer')).toBeGreaterThan(-1);
    expect(at(OMNI_ITEM.label)).toBeGreaterThan(at('Designer'));
    expect(at(OMNI_ITEM.label)).toBeLessThan(at('Create'));
  });
  it('opens over the workspace and any other destination closes it', () => {
    openOmni();
    expect(ui()).toMatchObject({ omni: true, home: false });
    openHome();
    expect(ui().omni).toBe(false);
    openOmni();
    openSpace(SPACES[0]); // same workspace as before: it still leaves
    expect(ui().omni).toBe(false);
    openOmni();
    setUi({ workspace: 'designer' });
    expect(ui().omni).toBe(false);
    openOmni();
    openCreate(CREATE[0]);
    expect(ui().omni).toBe(false);
  });
  it('is not remembered across reloads', async () => {
    const { pickUi } = await import('../src/store/persistUi');
    openOmni();
    expect('omni' in pickUi(ui())).toBe(false);
  });
});

describe('the node library of the omnicanvas', () => {
  const lib = (omni?: Parameters<typeof NodeLibrary>[0]['omni']) => renderToStaticMarkup(createElement(NodeLibrary, { onPick: () => undefined, omni }));
  it('lists Spaces and system parts only there, next to the ordinary nodes', () => {
    const plain = lib();
    expect(plain).not.toContain('Spaces');
    const withOmni = lib({ has: (s) => s === 'studio', onSpace: () => undefined, onSystem: () => undefined });
    for (const t of ['Studio', 'Nodes', 'Designer', 'Agent', 'Text']) expect(withOmni).toContain(t);
    expect(withOmni).toContain('Already here');
  });
});

const render = (C: React.ComponentType<never>, p: never) => renderToStaticMarkup(createElement(ReactFlowProvider, null, createElement(C as never, p)));

describe('the Space and chat cards', () => {
  const props = (id: string) => {
    const n = useStore.getState().sessions[sid].graph.nodes.find((x) => x.id === id)!;
    return { data: { node: n, solo: false, panel: true }, selected: false, id } as never;
  };
  it('a Space shows a thumbnail by default and its parameters as a node when switched', () => {
    ensureOmniNodes(sid);
    const id = omniSpaceNodeId('studio');
    const thumb = render(SpaceNode, props(id));
    expect(thumb).toContain('data-view="thumb"');
    expect(thumb).toContain('Thumbnail');
    setSpaceView(sid, id, 'node');
    const node = render(SpaceNode, props(id));
    expect(node).toContain('data-view="node"');
    expect(node).toContain('omni-params');
  });
  it('the chat shows the Studio chat docked and its agent and models undocked', () => {
    ensureOmniNodes(sid);
    const chat = useStore.getState().sessions[sid].graph.nodes.find((n) => n.data.kind === 'ref' && n.data.type === 'chat')!;
    expect(render(ChatNode, props(chat.id))).toContain('data-docked="true"');
  });
  it('the chat and the Spaces are wider than an ordinary card; the rest keep their width', () => {
    ensureOmniNodes(sid);
    const g = useStore.getState().sessions[sid].graph;
    const w = (pred: (n: (typeof g.nodes)[number]) => boolean) => omniWidth(g.nodes.find(pred)!.data, 260);
    expect(w((n) => n.data.kind === 'ref' && n.data.type === 'chat')).toBeGreaterThan(260);
    expect(w((n) => n.id === omniSpaceNodeId('nodes'))).toBeGreaterThan(260);
    expect(w((n) => n.data.kind === 'ref' && n.data.type === 'agent')).toBe(260);
  });
});

describe('loose assets on the omnicanvas', () => {
  it('a loose asset far from the main parts is brought next to them; a linked one is not moved', () => {
    ensureOmniNodes(sid);
    const put = (nodes: unknown[]) => useStore.setState((st) => {
      const g = st.sessions[sid].graph;
      return { sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: { ...g, nodes: [...g.nodes, ...nodes] as typeof g.nodes } } } };
    });
    put([{ id: 'far', position: { x: 9000, y: 9000 }, data: { kind: 'asset', title: 'Image', assetId: 'x1' } }]);
    ensureOmniNodes(sid);
    const main = useStore.getState().sessions[sid].graph.nodes.filter((n) => n.data.kind === 'ref');
    const far = useStore.getState().sessions[sid].graph.nodes.find((n) => n.id === 'far')!;
    const right = Math.max(...main.map((n) => n.position.x + omniWidth(n.data, 260)));
    expect(far.position.x).toBeLessThan(right + 900);
    expect(far.position.y).toBeLessThan(9000);
  });
});

describe('the ordinary Nodes canvas', () => {
  it('draws the system parts but no Space node after the omnicanvas was opened', () => {
    ensureOmniNodes(sid);
    const g = useStore.getState().sessions[sid].graph;
    expect(g.nodes.length).toBeGreaterThan(5);
    const seen = ordinaryGraph(g);
    expect(seen.nodes.length).toBeGreaterThan(0);
    expect(seen.nodes.every((n) => n.data.kind === 'ref' && n.data.type !== 'space')).toBe(true);
    expect(seen.nodes.length).toBeLessThan(g.nodes.length);
  });
});
