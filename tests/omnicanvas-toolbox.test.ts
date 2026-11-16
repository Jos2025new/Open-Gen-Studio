// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined, putAssetBlob: async () => undefined,
}));
import { CanvasNavigation } from '../src/components/node/CanvasNavigation';
import { createSession, useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* The canvas toolbox (omnicanvas-chrome): the omnicanvas keeps only the tools that move around the canvas; the ordinary
 * Nodes canvas keeps all of them. Mounted in jsdom: the store has no server snapshot of sessions. */
function bar(omni: boolean): string {
  const created = createSession('Toolbox');
  useStore.setState((st) => ({ sessions: { ...st.sessions, [created.id]: created }, activeSessionId: created.id }));
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(ReactFlowProvider, null, createElement(CanvasNavigation, {
      sessionId: created.id, add: createElement('i', null, 'ADD'), onAutoLayout: () => undefined, onSelect: () => undefined, tool: 'pan', onTool: () => undefined, selectedCount: 0, onDelete: () => undefined, omni,
    })));
  });
  const html = host.innerHTML;
  act(() => root.unmount());
  host.remove();
  return html;
}

describe('the omnicanvas toolbox', () => {
  it('keeps only select, pan, cut, add, fit view, map, undo, redo and zoom in and out', () => {
    const html = bar(true);
    for (const t of ['Select', 'Pan', 'Cut connections', 'ADD', 'Fit view', 'Map', 'Undo', 'Redo', 'Zoom in', 'Zoom out']) expect(html).toContain(t);
    for (const t of ['Create', 'Conversation', 'Auto layout', 'Delete selected', 'Search canvas']) expect(html).not.toContain(t);
  });
  it('the ordinary Nodes canvas keeps its full toolbox', () => {
    const html = bar(false);
    for (const t of ['Auto layout', 'Delete selected', 'Search canvas', 'Create', 'Conversation']) expect(html).toContain(t);
  });
});
