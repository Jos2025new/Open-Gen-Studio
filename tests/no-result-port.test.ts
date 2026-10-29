// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { ResultPorts } from '../src/components/node/ConnectedNodeMenu';
import { GONE_HANDLE, NO_RESULT } from '../src/engine/flow/graph';
import { createSession, useStore } from '../src/store/store';
import type { GraphNode } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps a handle for a link whose output was deleted', () => {
  const node = { id: 'n', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'Image', settings: { count: 1, advanced: {} }, outputIndex: 0 } } as GraphNode;
  const s = createSession();
  useStore.setState({ activeSessionId: s.id, sessions: { [s.id]: { ...s, graph: { nodes: [node], edges: [{ id: 'e', source: 'n', target: 'dest', sourceHandle: GONE_HANDLE, targetHandle: 'ref', outputIndex: NO_RESULT }] } } } });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(ReactFlowProvider, null, createElement(ResultPorts, { node, out: 'image' }))));
  expect(host.querySelector(`[data-handleid="${GONE_HANDLE}"]`)).not.toBeNull();
  act(() => root.unmount());
  host.remove();
});
