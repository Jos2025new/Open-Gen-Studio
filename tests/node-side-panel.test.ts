// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@xyflow/react', () => ({ Panel: ({ children, className }: { children: ReactNode; className?: string }) => createElement('div', { className }, children) }));
vi.mock('../src/components/chat/FeedList', () => ({ FeedList: () => createElement('div', { className: 'feed-mock' }), NoticeView: () => createElement('button', null, 'Undo') }));
vi.mock('../src/components/assets/GenerationInfo', () => ({ GenerationInfo: () => createElement('div', { className: 'info-mock' }) }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined } }));
import { NodeSide } from '../src/components/node/NodeSide';
import { setNodeSelection } from '../src/engine/flow/selection';
import { useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initial = useStore.getState();
const id = initial.activeSessionId;
afterEach(() => useStore.setState(initial, true));

const setSession = (patch: object) => useStore.setState({ sessions: { ...initial.sessions, [id]: { ...initial.sessions[id], ...patch } as never } });
const user = { id: 'u', createdAt: 0, type: 'user', text: 'hello', attachments: [] };

function mount() {
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(createElement(NodeSide, { sessionId: id })));
  return { host, root, click: (sel: string) => act(() => host.querySelector<HTMLElement>(sel)?.click()) };
}

it('the corner is not drawn with nothing to show; before any Nodes agent message it holds only the notices (Undo); then the conversation', () => {
  setSession({ feed: [{ ...user, workspace: 'chat', mode: 'agent' }, { ...user, workspace: 'node', mode: 'image' }] });
  const { host, root } = mount();
  expect(host.querySelector('.node-side')).toBeNull();
  act(() => setSession({ feed: [{ id: 'n', createdAt: 0, type: 'notice', workspace: 'node', undoNodes: { nodes: [], edges: [] } }] }));
  expect(host.textContent).toContain('Undo');
  expect(host.querySelector('.feed-mock')).toBeNull();
  act(() => setSession({ feed: [{ ...user, workspace: 'node', mode: 'agent' }] }));
  expect(host.querySelector('.side-title')?.textContent).toBe('Conversation');
  expect(host.querySelector('.feed-mock')).not.toBeNull();
  act(() => root.unmount());
});

it('folding leaves only the title pill; unfolding brings the body back', () => {
  setSession({ feed: [{ ...user, workspace: 'node', mode: 'agent' }] });
  const { host, root, click } = mount();
  click('.side-toggle');
  expect(host.querySelector('.node-side.is-folded')).not.toBeNull();
  expect(host.querySelector('.side-body')).toBeNull();
  click('.side-toggle');
  expect(host.querySelector('.side-body .feed-mock')).not.toBeNull();
  act(() => root.unmount());
});

it('one selected node with a result shows its details; closing them returns to the conversation', () => {
  const asset = { id: 'a1', kind: 'image', mime: 'image/png', width: 8, height: 8, sessionId: id, origin: 'upload', createdAt: 0 };
  const node = { id: 'nd1', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Ref', assetId: 'a1' } };
  useStore.setState({ assets: { a1: asset } as never });
  setSession({ feed: [{ ...user, workspace: 'node', mode: 'agent' }], graph: { ...initial.sessions[id].graph, nodes: [node] } });
  act(() => setNodeSelection(id, ['nd1']));
  const { host, root, click } = mount();
  expect(host.querySelector('.side-title')?.textContent).toBe('Ref');
  expect(host.querySelector('.side-body .info-mock')).not.toBeNull();
  click('[aria-label="Close details"]');
  expect(host.querySelector('.side-body .feed-mock')).not.toBeNull();
  act(() => { setNodeSelection(id, []); root.unmount(); });
});

it('Nodes keeps the floating prompt box; the corner is a canvas panel clear of it; the prompt re-measures per workspace', () => {
  const composer = readFileSync('src/components/composer/Composer.tsx', 'utf8');
  expect(composer).toMatch(/\{workspace !== 'chat' && workspace !== 'node' \? <ThreadPeek workspace=\{workspace\} \/> : null\}/);
  expect(composer).not.toContain('NodeSide');
  expect(composer).toMatch(/\}, \[text, mode, showTools, workspace\]\);/);
  expect(readFileSync('src/components/node/SelectionPanel.tsx', 'utf8')).toMatch(/<NodeSide sessionId=\{sessionId\} \/>/);
  const css = readFileSync('src/styles/node-side.css', 'utf8');
  expect(css).toMatch(/\.react-flow__panel\.node-side \{[^}]*max-height: calc\(100% - var\(--composer-height, 120px\) - 60px\);[^}]*border: 1px solid var\(--panel-line\); border-radius: var\(--toolbar-radius\)/);
  expect(css).not.toMatch(/composer-dock/);
});
