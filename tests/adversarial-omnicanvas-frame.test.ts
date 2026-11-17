// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOmniFraming } from '../src/components/omni/useOmniFraming';
import { ensureOmniNodes } from '../src/engine/nodes/omni';
import { newSession, useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ sid, fitView }: { sid: string; fitView: (options: unknown) => void }) {
  useOmniFraming(true, sid, { fitView } as never);
  return null;
}

describe('adversarial omnicanvas opening frame', () => {
  afterEach(() => { vi.useRealTimers(); });

  it.each([
    ['small window', { width: 240, height: 180 }],
    ['very tall agent node', { width: 400, height: 3200 }],
    ['extreme zoom', { width: 400, height: 900 }],
    ['no agent node', null],
  ])('includes the complete agent node in the fit request (%s)', (_label, agentSize) => {
    vi.useFakeTimers();
    const sid = newSession();
    ensureOmniNodes(sid);
    const session = useStore.getState().sessions[sid];
    const nodes = session.graph.nodes.filter((node) => node.data.kind === 'ref' && (node.data.type === 'space' || node.data.type === 'chat'));
    if (agentSize) nodes.push({ id: 'adversarial-agent', position: { x: 0, y: 0 }, width: agentSize.width, height: agentSize.height, data: { kind: 'ref', type: 'agent', ref: sid, title: 'Agent' } } as never);
    useStore.setState((state) => ({ sessions: { ...state.sessions, [sid]: { ...session, graph: { ...session.graph, nodes } } } }));
    const fitView = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(createElement(Harness, { sid, fitView })));
    act(() => { vi.advanceTimersByTime(150); });
    const request = fitView.mock.calls[0]?.[0] as { nodes?: { id: string }[]; minZoom?: number };
    if (agentSize) expect(request.nodes).toContainEqual({ id: 'adversarial-agent' });
    else expect(request.nodes).not.toContainEqual({ id: 'adversarial-agent' });
    expect(request.minZoom).toBe(0.35);
    act(() => root.unmount());
    host.remove();
  });
});
