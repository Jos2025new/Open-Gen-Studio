// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('../src/components/chat/FeedList', () => ({ FeedList: () => null, NoticeView: () => createElement('button', null, 'Undo') }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined } }));
import { ThreadPeek } from '../src/components/composer/ThreadPeek';
import { useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initial = useStore.getState();
afterEach(() => useStore.setState(initial, true));

it('shows the Nodes conversation only after a Nodes agent message in this session', () => {
  const id = initial.activeSessionId;
  const host = document.createElement('div');
  const root = createRoot(host);
  const setFeed = (feed: unknown[]) => useStore.setState({ sessions: { ...initial.sessions, [id]: { ...initial.sessions[id], feed: feed as never } }, ui: { ...initial.ui, workspace: 'node', threadOpen: false } });
  const item = { id: 'u', createdAt: 0, type: 'user', text: 'hello', attachments: [] };
  act(() => { setFeed([{ ...item, workspace: 'chat', mode: 'agent' }, { ...item, workspace: 'node', mode: 'image' }]); root.render(createElement(ThreadPeek, { workspace: 'node' })); });
  expect(host.querySelector('.thread-toggle')).toBeNull();
  act(() => setFeed([{ id: 'n', createdAt: 0, type: 'notice', workspace: 'node', undoNodes: { nodes: [], edges: [] } }]));
  expect(host.querySelector('.thread-toggle')).toBeNull();
  expect(host.textContent).toContain('Undo');
  act(() => setFeed([{ id: 'e', createdAt: 0, type: 'notice', workspace: 'node', level: 'error', text: 'Boom' }]));
  expect(host.querySelector('.thread-toggle')).toBeNull();
  expect(host.querySelector('.composer-alerts')).not.toBeNull();
  act(() => setFeed([{ ...item, workspace: 'node', mode: 'agent' }]));
  expect(host.querySelector('.thread-toggle')?.textContent).toContain('Conversation');
  act(() => root.unmount());
});
