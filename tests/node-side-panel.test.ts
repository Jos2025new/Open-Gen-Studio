// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@xyflow/react', () => ({ Panel: ({ children, className }: { children: ReactNode; className?: string }) => createElement('div', { className }, children) }));
vi.mock('../src/components/chat/FeedList', () => ({ FeedList: () => createElement('div', { className: 'feed-mock' }), NoticeView: () => createElement('button', null, 'Undo') }));
vi.mock('../src/components/node/ResultSummary', () => ({ ResultSummary: () => createElement('div', { className: 'info-mock' }) }));
vi.mock('../src/components/composer/Composer', () => ({ AttachStrip: () => null, SendDirect: ({ kind }: { kind: string }) => createElement('button', { className: 'send-mock' }, `Generate ${kind}`) }));
vi.mock('../src/components/composer/MediaControls', () => ({ ModelChip: ({ kind }: { kind: string }) => createElement('span', { className: 'model-mock' }, kind), MediaControls: () => null }));
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

it('folded, the corner is two icons and an arrow; open, the views are named; the arrow folds and unfolds it', () => {
  const { host, root, click } = mount();
  expect([...host.querySelectorAll('.side-head .side-icon')].map((b) => b.getAttribute('aria-label'))).toEqual(['Conversation', 'Create', 'Unfold']);
  expect(host.querySelector('.side-head')?.textContent).toBe('');
  expect(host.querySelector('.node-side.is-folded')).not.toBeNull();
  click('[aria-label="Create"]');
  expect(host.querySelector('.side-create')).not.toBeNull();
  expect([...host.querySelectorAll('.side-label')].map((l) => l.textContent)).toEqual(['Conversation', 'Create']);
  click('[aria-label="Fold"]');
  expect(host.querySelector('.side-body')).toBeNull();
  expect(host.querySelector('.side-label')).toBeNull();
  click('[aria-label="Unfold"]');
  expect(host.querySelector('.side-create')).not.toBeNull();
  act(() => root.unmount());
});

it('Create uses the prompt box’s own state: kind, prompt and Generate are linked', () => {
  useStore.setState({ composer: { ...initial.composer, mode: 'agent', text: '' } });
  const { host, root, click } = mount();
  click('[aria-label="Create"]');
  expect(host.querySelector('.side-kind.is-active')?.textContent).toContain('Image');
  act(() => [...host.querySelectorAll<HTMLElement>('.side-kind')].find((b) => b.textContent?.includes('Video'))?.click());
  expect(useStore.getState().composer.mode).toBe('video');
  expect(host.querySelector('.model-mock')?.textContent).toBe('video');
  expect(host.querySelector('.send-mock')?.textContent).toBe('Generate video');
  act(() => useStore.setState({ composer: { ...useStore.getState().composer, text: 'a red fox' } }));
  expect(host.querySelector<HTMLTextAreaElement>('.side-prompt')?.value).toBe('a red fox');
  act(() => root.unmount());
});

it('with a Nodes conversation it opens on it; before any, the Conversation view holds the notices (Undo)', () => {
  setSession({ feed: [{ id: 'n', createdAt: 0, type: 'notice', workspace: 'node', undoNodes: { nodes: [], edges: [] } }] });
  const first = mount();
  first.click('[aria-label="Conversation"]');
  expect(first.host.textContent).toContain('Undo');
  act(() => first.root.unmount());
  setSession({ feed: [{ ...user, workspace: 'node', mode: 'agent' }] });
  const second = mount();
  expect(second.host.querySelector('.side-body .feed-mock')).not.toBeNull();
  act(() => second.root.unmount());
});

it('one selected node with a result shows its details; closing them returns to the open view', () => {
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

it('Nodes keeps the floating prompt box; Create attaches through its picker; the corner stays clear of it', () => {
  const composer = readFileSync('src/components/composer/Composer.tsx', 'utf8');
  expect(composer).toMatch(/\{workspace !== 'chat' && workspace !== 'node' \? <ThreadPeek workspace=\{workspace\} \/> : null\}/);
  expect(composer).toMatch(/\}, \[text, mode, showTools, workspace\]\);/);
  expect(composer).toMatch(/window\.addEventListener\('ogs:attach', pick\)/);
  expect(readFileSync('src/components/node/NodeSide.tsx', 'utf8')).toMatch(/window\.dispatchEvent\(new Event\('ogs:attach'\)\)/);
  expect(readFileSync('src/components/node/SelectionPanel.tsx', 'utf8')).toMatch(/<NodeSide sessionId=\{sessionId\} \/>/);
  const css = readFileSync('src/styles/node-side.css', 'utf8');
  expect(readFileSync('src/styles/prompt-box.css', 'utf8')).toMatch(/\.composer-dock\.dock-node::before, \.composer-dock\.dock-designer::before \{ content: ''[^}]*inset: -12px -12px -40px; background: var\(--bg-canvas\);[^}]*border-radius: calc\(var\(--r-l\) \+ 12px\)/);
  expect(css).toMatch(/\.react-flow__panel\.node-side \{[^}]*max-height: calc\(100% - var\(--composer-height, 120px\) - 60px\);[^}]*border: 1px solid var\(--panel-line\); border-radius: var\(--toolbar-radius\)/);
});

it('the selected result reads like a card: kind, model, prompt, settings chips, Reusar and Copy; the full record folds under All details', () => {
  const src = readFileSync('src/components/node/ResultSummary.tsx', 'utf8');
  const order = ['rs-line"><KindIcon', 'rs-line"><Layers', 'rs-prompt', 'rs-inputs', 'rs-chips', '<ReuseButton', 'icon={Copy}', 'All details <ChevronDown', '<GenerationInfo'].map((t) => src.indexOf(t));
  expect(order.every((i) => i > 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(src).toMatch(/\{more \? <GenerationInfo/);
  expect(src).toContain('className="cc-mini num"');
});

it('Create uses the grid icon; Auto layout in the toolbox uses the tidy-blocks icon (not the Nodes icon), so the two never look alike', () => {
  expect(readFileSync('src/components/node/NodeSide.tsx', 'utf8')).toMatch(/aria-label="Create"[\s\S]{0,200}<LayoutGrid size=\{15\} \/>/);
  const nav = readFileSync('src/components/node/CanvasNavigation.tsx', 'utf8');
  expect(nav).toMatch(/<IconButton icon=\{LayoutDashboard\} label="Auto layout"/);
  expect(nav).not.toContain('Workflow');
  expect(nav).not.toContain('LayoutGrid');
});
