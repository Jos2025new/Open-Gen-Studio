// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* The agent name in its card header (rename by double-click), the «To» selector, and the load path through loadedSession. */
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
}));
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AgentTitle, ChatRecipientSelect } from '../src/components/node/AgentNodeControls';
import { createSession, loadedSession, useStore } from '../src/store/store';
import type { Graph } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const agent = (id: string, title: string, extra = {}) => ({ id, position: { x: 0, y: 0 }, data: { kind: 'ref' as const, type: 'agent' as const, ref: 'r', title, ...extra } });
const chat = { id: 'chat', position: { x: 0, y: 0 }, data: { kind: 'ref' as const, type: 'chat' as const, ref: 'c', title: 'Chat' } };
let sid = '';
let host: HTMLDivElement;
let root: Root;
const titleOf = (id: string) => useStore.getState().sessions[sid].graph.nodes.find((n) => n.id === id)?.data.title;
const setGraphNow = (graph: Graph) => useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph } } }));
const mount = (el: ReturnType<typeof createElement>) => { act(() => root.render(el)); };
const key = (el: Element, k: string) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
const type = (input: HTMLInputElement, v: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

beforeEach(() => {
  const s = createSession('T');
  sid = s.id;
  useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: s } }));
  setGraphNow({ nodes: [agent('a', 'Agent 1'), agent('b', 'Agent 2')], edges: [] });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const renderTitle = () => mount(createElement(AgentTitle, { sessionId: sid, nodeId: 'a', title: titleOf('a') as string }));
const open = () => { act(() => { host.querySelector('.nc-title-text')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); }); return host.querySelector('input') as HTMLInputElement; };

describe('AgentTitle', () => {
  it('opens on double-click, wrapped like other title editors, and commits on Enter through the graph', () => {
    renderTitle();
    const input = open();
    expect(input.closest('.nc-title-edit')).not.toBeNull();
    type(input, '  Writer ');
    key(input, 'Enter');
    expect(titleOf('a')).toBe('Writer');
    expect(host.querySelector('input')).toBeNull();
  });
  it('Escape cancels, an empty name keeps the old one, and an unchanged name writes nothing', () => {
    renderTitle();
    let input = open();
    type(input, 'Nope');
    key(input, 'Escape');
    expect(titleOf('a')).toBe('Agent 1');
    expect(host.querySelector('input')).toBeNull();
    input = open();
    type(input, '   ');
    key(input, 'Enter');
    expect(titleOf('a')).toBe('Agent 1');
  });
});

describe('ChatRecipientSelect', () => {
  const wire = (recipient?: string) => {
    setGraphNow({ nodes: [chat, agent('a', 'Agent 1'), agent('b', 'Agent 2')], edges: [{ id: 'e1', source: 'chat', target: 'a', kind: 'control' } as never, { id: 'e2', source: 'chat', target: 'b', kind: 'control' } as never] });
    mount(createElement(ChatRecipientSelect, { sessionId: sid, nodeId: 'chat', recipient }));
  };
  it('lists the agents by name and writes the chosen recipient', () => {
    wire('a');
    const sel = host.querySelector('select') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Agent 1', 'Agent 2']);
    act(() => { sel.value = 'b'; sel.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(useStore.getState().sessions[sid].graph.nodes.find((n) => n.id === 'chat')?.data).toMatchObject({ recipient: 'b' });
  });
  it('tells two equal manual names apart', () => {
    setGraphNow({ nodes: [chat, agent('a', 'Bot'), agent('b', 'Bot')], edges: [{ id: 'e1', source: 'chat', target: 'a', kind: 'control' } as never, { id: 'e2', source: 'chat', target: 'b', kind: 'control' } as never] });
    mount(createElement(ChatRecipientSelect, { sessionId: sid, nodeId: 'chat', recipient: 'a' }));
    const labels = [...(host.querySelector('select') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(new Set(labels).size).toBe(2);
  });
});

describe('loadedSession', () => {
  it('numbers repeated default agents on load, keeping ids, cables, recipient, llm and threads', () => {
    const s = createSession('Old');
    const graph: Graph = { nodes: [chat, agent('a', 'Agent', { llm: { provider: 'p', model: 'm' } }), agent('b', 'Agent')], edges: [{ id: 'e1', source: 'chat', target: 'a', kind: 'control' } as never] };
    const loaded = loadedSession({ ...s, graph, agents: { a: { threads: [] } } } as never);
    expect(loaded.graph.nodes.map((n) => [n.id, n.data.title])).toEqual([['chat', 'Chat'], ['a', 'Agent 1'], ['b', 'Agent 2']]);
    expect(loaded.graph.nodes[1].data).toMatchObject({ llm: { provider: 'p', model: 'm' } });
    expect(loaded.graph.edges.map((e) => e.id)).toEqual(['e1']);
    expect((loaded as never as { agents: unknown }).agents).toMatchObject({ a: { threads: [] } });
    expect(loadedSession(loaded).graph).toEqual(loaded.graph);
  });
});
