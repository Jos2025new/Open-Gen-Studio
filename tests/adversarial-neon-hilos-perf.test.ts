// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
}));

import { act, createElement, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { setComposer, updateFeedItem, useStore } from '../src/store/store';
import { PlanCard } from '../src/components/chat/PlanCard';
import { RunButton } from '../src/components/node/nodes';
import { useLive } from '../src/components/node/SystemNode';
import { sessionChatText } from '../src/engine/nodecore/resolver';
import type { AssistantFeedItem, Graph, GraphNode, PlanFeedItem } from '../src/engine/types';
import { mainThread } from './helpers/threads';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOME = useStore.getState().activeSessionId;
const imgNode: GraphNode = {
  id: 'img_standalone',
  position: { x: 0, y: 0 },
  data: { kind: 'image', title: 'Standalone', prompt: 'sunset', modelRef: 'local::studio-image', settings: { count: 1, advanced: {} }, outputIndex: 0 },
};
const chatRefNode: GraphNode = {
  id: 'chat1',
  position: { x: 0, y: 0 },
  data: { kind: 'ref', type: 'chat', ref: HOME, title: 'Chat' },
};
const donePlan: PlanFeedItem = {
  id: 'plan_done_1',
  createdAt: 1,
  workspace: 'chat',
  type: 'plan',
  style: 'auto',
  status: 'done',
  plan: {
    id: 'pln_done',
    title: 'Plan ya terminado',
    summary: 'Hecho',
    workspace: 'chat',
    steps: [{ id: 's1', kind: 'text', title: 'Nota', text: 'listo' }],
    adjustments: [],
  },
  estimate: { usd: 0, approximate: false },
  stepStates: { s1: 'done' },
  stepGenerations: {},
  meta: { agentNodeId: 'agentA', chatNodeId: 'chat1' },
};
const streamMsg: AssistantFeedItem = {
  id: 'asst_stream',
  createdAt: 2,
  workspace: 'chat',
  type: 'assistant',
  text: '',
  streaming: true,
  engine: 'Director',
  meta: { agentNodeId: 'agentA', chatNodeId: 'chat1' },
};

const roots: Root[] = [];
async function mount(el: ReturnType<typeof createElement>) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => { root.render(el); });
  return { host, root };
}

beforeEach(() => {
  const st = useStore.getState();
  const graph: Graph = { nodes: [imgNode, chatRefNode], edges: [] };
  useStore.setState({
    activeSessionId: HOME,
    generations: {},
    assets: {},
    sessions: {
      ...st.sessions,
      [HOME]: {
        ...st.sessions[HOME],
        graph,
        feed: [donePlan, streamMsg],
        agents: mainThread({ history: [], questionRound: 0, notes: [], busy: true }),
      },
    },
  });
});

afterEach(async () => {
  while (roots.length) {
    const r = roots.pop()!;
    await act(async () => { r.unmount(); });
  }
  document.body.innerHTML = '';
});

describe('adversarial: lentitud y re-renders por token', () => {
  // FALLO REAL: PlanCard (src/components/chat/PlanCard.tsx:149) se suscribe a `s.sessions[sessionId]?.feed` incluso en planes ya cerrados (`status: 'done'`); cada token transmitido en el chat re-renderiza todos los PlanCard históricos del feed.
  it('PlanCard ya terminado (`status: "done"`) no debe re-renderizarse en cada token transmitido al asistente', async () => {
    let commits = 0;
    await mount(
      createElement(Profiler, { id: 'plan', onRender: () => { commits++; } },
        createElement(PlanCard, { item: donePlan, sessionId: HOME }),
      ),
    );
    const initial = commits;
    for (let i = 1; i <= 15; i++) {
      await act(async () => {
        updateFeedItem<AssistantFeedItem>(HOME, streamMsg.id, { text: `tok `.repeat(i) });
      });
    }
    expect(commits - initial).toBe(0);
  });

  // FALLO REAL: RunButton con `primary={true}` (src/components/node/nodes.tsx:61) usa `usePreviewDeps(sessionId, true)` (src/components/node/usePreviewDeps.ts:12) que suscribe a `session.feed` y `composer.text`; un nodo sin entradas de chat ni composer se re-renderiza y recalcula `previewRun` en cada token y cada tecla.
  it('RunButton primary de un nodo independiente no debe re-renderizarse ni recalcular preview en cada token del chat ni en cada tecla del composer', async () => {
    let commits = 0;
    await mount(
      createElement(Profiler, { id: 'run-primary', onRender: () => { commits++; } },
        createElement(RunButton, { node: imgNode, primary: true }),
      ),
    );
    const initial = commits;
    for (let i = 1; i <= 10; i++) {
      await act(async () => {
        updateFeedItem<AssistantFeedItem>(HOME, streamMsg.id, { text: `token ${i}` });
      });
    }
    for (let i = 1; i <= 5; i++) {
      await act(async () => { setComposer({ text: `typing ${i}` }); });
    }
    expect(commits - initial).toBe(0);
  });

  // FALLO REAL: useLive (src/components/node/SystemNode.tsx:60-63) ejecuta `resolveSystemNodeLive` + `JSON.stringify` en cada cambio del store (cada token), y spec.ts:306 hace `[...feed].reverse()` en cada token, re-renderizando ChatNode en cada delta.
  it('useLive en nodo Chat no debe re-renderizar en cada token del streaming de una respuesta', async () => {
    let commits = 0;
    function Probe() {
      const live = useLive(HOME, chatRefNode);
      return createElement('div', null, live?.details[0] ?? '');
    }
    await mount(createElement(Profiler, { id: 'live-chat', onRender: () => { commits++; } }, createElement(Probe)));
    const initial = commits;
    for (let i = 1; i <= 10; i++) {
      await act(async () => {
        updateFeedItem<AssistantFeedItem>(HOME, streamMsg.id, { text: `hola ${i}` });
      });
    }
    expect(commits - initial).toBeLessThanOrEqual(1);
  });

  // Ataques que pasan: verifican los arreglos reales de dbdac780.
  it('RunButton cerrado (`primary` false, popover cerrado) no se re-renderiza en cada token del chat', async () => {
    let commits = 0;
    await mount(
      createElement(Profiler, { id: 'run-closed', onRender: () => { commits++; } },
        createElement(RunButton, { node: imgNode }),
      ),
    );
    const initial = commits;
    for (let i = 1; i <= 10; i++) {
      await act(async () => {
        updateFeedItem<AssistantFeedItem>(HOME, streamMsg.id, { text: `token ${i}` });
      });
    }
    expect(commits - initial).toBe(0);
  });

  it('sessionChatText (resolver.ts) lee el feed sin copiarlo ni llamar reverse()', () => {
    const revSpy = vi.spyOn(Array.prototype, 'reverse');
    const txt = sessionChatText(chatRefNode);
    expect(txt).toBeUndefined(); // streamMsg es assistant, chat busca user
    expect(revSpy).not.toHaveBeenCalled();
    revSpy.mockRestore();
  });
});
