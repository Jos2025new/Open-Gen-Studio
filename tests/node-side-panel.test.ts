// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('../src/components/chat/FeedList', () => ({ FeedList: () => createElement('div', { className: 'feed-mock' }), NoticeView: () => createElement('button', null, 'Undo') }));
vi.mock('../src/components/assets/GenerationInfo', () => ({ GenerationInfo: () => createElement('div', { className: 'info-mock' }) }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined } }));
import { NodeSide } from '../src/components/composer/NodeSide';
import { setNodeSelection } from '../src/engine/flow/selection';
import { useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initial = useStore.getState();
afterEach(() => useStore.setState(initial, true));

function mount() {
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(createElement(NodeSide)));
  return { host, root, click: (sel: string, text?: string) => act(() => ([...host.querySelectorAll<HTMLElement>(sel)].find((b) => !text || b.textContent?.includes(text)) ?? null)?.click()) };
}

it('Create and Agent are tabs of one panel: they switch the composer mode, and Create returns to the last direct mode', () => {
  useStore.setState({ composer: { ...initial.composer, mode: 'video' }, ui: { ...initial.ui, workspace: 'node' } });
  const { host, root, click } = mount();
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Create');
  click('.side-tab', 'Agent');
  expect(useStore.getState().composer.mode).toBe('agent');
  expect(host.querySelector('.side-thread')).not.toBeNull();
  click('.side-tab', 'Create');
  expect(useStore.getState().composer.mode).toBe('video');
  expect(host.querySelector('.side-thread')).toBeNull();
  act(() => root.unmount());
});

it('the Agent tab holds the Nodes conversation; Create keeps the last notices (Undo) at hand; folding hides the thread', () => {
  const id = initial.activeSessionId;
  const notice = { id: 'n', createdAt: 0, type: 'notice', workspace: 'node', undoNodes: { nodes: [], edges: [] } };
  useStore.setState({ composer: { ...initial.composer, mode: 'image' }, ui: { ...initial.ui, workspace: 'node' }, sessions: { ...initial.sessions, [id]: { ...initial.sessions[id], feed: [notice] as never } } });
  const { host, root, click } = mount();
  expect(host.textContent).toContain('Undo');
  click('.side-tab', 'Agent');
  expect(host.querySelector('.feed-mock')).not.toBeNull();
  click('.side-fold');
  expect(host.querySelector('.side-thread')).toBeNull();
  act(() => root.unmount());
});

it('one selected node with a result shows its details until closed', () => {
  const id = initial.activeSessionId;
  const asset = { id: 'a1', kind: 'image', mime: 'image/png', width: 8, height: 8, sessionId: id, origin: 'upload', createdAt: 0 };
  const node = { id: 'nd1', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Ref', assetId: 'a1' } };
  const session = initial.sessions[id];
  useStore.setState({ composer: { ...initial.composer, mode: 'image' }, assets: { a1: asset } as never, sessions: { ...initial.sessions, [id]: { ...session, graph: { ...session.graph, nodes: [node] } } as never } });
  act(() => setNodeSelection(id, ['nd1']));
  const { host, root, click } = mount();
  expect(host.querySelector('.side-info .info-mock')).not.toBeNull();
  expect(host.querySelector('.side-info-title')?.textContent).toBe('Ref');
  click('[aria-label="Close details"]');
  expect(host.querySelector('.side-info')).toBeNull();
  act(() => { setNodeSelection(id, []); root.unmount(); });
});

it('in Nodes the composer dock is the left panel (no Conversation card); the Designer keeps its thread card', () => {
  const composer = readFileSync('src/components/composer/Composer.tsx', 'utf8');
  expect(composer).toMatch(/\{workspace === 'node' \? <NodeSide \/> : workspace !== 'chat' \? <ThreadPeek workspace=\{workspace\} \/> : null\}/);
  const css = readFileSync('src/styles/node-side.css', 'utf8');
  expect(css).toMatch(/\.composer-dock\.dock-node \{[^}]*border: 1px solid var\(--panel-line\); border-radius: var\(--toolbar-radius\)/);
  expect(css).toMatch(/\.composer-dock\.dock-node\.is-agent \{ bottom: 15px; \}/);
});
