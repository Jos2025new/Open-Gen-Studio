import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, {
  window: { setTimeout, clearTimeout, addEventListener() {} },
  document: { addEventListener() {}, visibilityState: 'visible' },
}));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
}));
const executeSteps = vi.hoisted(() => vi.fn());
vi.mock('../src/engine/executor', async (orig) => ({ ...(await orig<typeof import('../src/engine/executor')>()), executeSteps }));
const chat = vi.hoisted(() => vi.fn());
vi.mock('../src/engine/providers/llm', async (orig) => ({ ...(await orig<typeof import('../src/engine/providers/llm')>()), chat }));
vi.mock('../src/lib/writerLock', () => ({ holdsWriterLock: () => true, mayStartWork: () => true, getWriterState: () => ({ role: 'writer', requested: false }), onWriterLockGranted: () => () => undefined }));

import { useStore } from '../src/store/store';
import { approvePlan, presentNodeRun, sendAgentMessage } from '../src/engine/agent/runtime';
import { LEDGER_LIMIT, prepareAction, resetActions, runAction, snapshotById } from '../src/engine/nodecore/action';
import { draftMode } from '../src/engine/agent/draftFirst';
import { carried } from '../src/engine/agent/draftActions';
import type { Graph, PlanFeedItem, SettingsFeedItem } from '../src/engine/types';
import { mainThread } from './helpers/threads';

const HOME = useStore.getState().activeSessionId;
const ref = (id: string, type: 'chat' | 'agent') => ({ id, position: { x: 0, y: 0 }, data: { kind: 'ref' as const, type, ref: HOME, title: id } });
const control = (id: string, source: string, target: string) => ({ id, source, target, sourceHandle: 'out_control', targetHandle: 'control', kind: 'control' as const });
const imgNode = (id: string) => ({
  id,
  position: { x: 200, y: 0 },
  data: { kind: 'image' as const, title: id, prompt: 'red sphere', modelRef: 'local::studio-image', settings: { count: 1, advanced: {} }, outputIndex: 0 },
});

const baseGraph = (): Graph => ({
  nodes: [ref('chat1', 'chat'), ref('agentA', 'agent'), ref('chat2', 'chat'), ref('agentB', 'agent'), imgNode('img1')],
  edges: [control('c1', 'chat1', 'agentA'), control('c2', 'chat2', 'agentB')],
});

const S = () => useStore.getState().sessions[HOME];

beforeEach(() => {
  resetActions();
  executeSteps.mockReset();
  chat.mockReset();
  const st = useStore.getState();
  useStore.setState({
    activeSessionId: HOME,
    generations: {},
    assets: {},
    composer: { ...st.composer, agentStyle: 'auto' },
    settings: {
      ...st.settings,
      keys: { ...st.settings.keys, openrouter: 'sk-test' },
      agent: { ...st.settings.agent, provider: 'openrouter', model: 'openai/gpt-4o-mini', showThinking: false },
    },
    sessions: {
      ...st.sessions,
      [HOME]: {
        ...st.sessions[HOME],
        graph: baseGraph(),
        feed: [],
        agents: mainThread({ history: [], questionRound: 0, notes: [], busy: false }),
        agentLane: undefined,
      },
    },
  });
});

describe('adversarial: dinero, doble gasto y reutilización de aprobaciones', () => {
  // FALLO REAL: runAction (src/engine/nodecore/action.ts:126-135) nunca comprueba `snapshots.has(snapshot.id)`; tras LEDGER_LIMIT ejecuciones, `trim()` expulsa el registro gastado del ledger y del mapa de snapshots, pero volver a llamar `runAction(spentSnapshot, nuevoRunId)` sobre un nodo real vuelve a ejecutar y cobrar.
  it('aprobación ya gastada NO debe poder reutilizarse después de que `trim()` la expulse del ledger', async () => {
    executeSteps.mockResolvedValue({ outputs: new Map([['img1', { assetIds: [] }]]), failed: [], skipped: [], waiting: [] });
    const first = await prepareAction(HOME, ['img1']);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const r1 = await runAction(first.snapshot, 'run-1');
    expect(r1.status).toBe('done');
    expect(executeSteps).toHaveBeenCalledTimes(1);

    // Llenar y desbordar el ledger con otras ejecuciones para disparar trim()
    for (let i = 0; i < LEDGER_LIMIT + 10; i++) {
      const p = await prepareAction(HOME, ['img1']);
      expect(p.ok).toBe(true);
      if (!p.ok) return;
      await runAction(p.snapshot, `fill-${i}`);
    }
    expect(snapshotById(first.snapshot.id)).toBeUndefined();

    const callsBefore = executeSteps.mock.calls.length;
    const reused = await runAction(first.snapshot, 'run-reuse-after-trim');
    expect(reused.status).toBe('stale');
    expect(executeSteps).toHaveBeenCalledTimes(callsBefore);
  });

  // FALLO REAL: approveNodeRunNow (src/engine/agent/planNodeRun.ts:43-47) vuelve a poner la tarjeta en `status: 'awaiting'` cuando `record.result` es undefined (excepción tras `record.attempted = true`), y el segundo clic en Approve genera un nuevo `uid('run')` y una nueva aprobación cobrando dos veces.
  it('approveNodeRun: si el envío falla con excepción tras haberse intentado, la tarjeta no debe volver a `awaiting` permitiendo otro cobro automático al re-clicar Approve', async () => {
    const card = await presentNodeRun(HOME, ['img1'], 'tc_nr', { agentNodeId: 'agentA', chatNodeId: 'chat1' }, 'agentA');
    expect(card.errors).toEqual([]);
    const itemId = card.itemId!;

    executeSteps.mockRejectedValueOnce(new Error('network drop after provider accepted'));
    await approvePlan(HOME, itemId);
    expect(executeSteps).toHaveBeenCalledTimes(1);

    // La tarjeta NO debe volver a `awaiting` (un envío intentado gasta la aprobación y puede haber cobrado)
    const afterFirst = S().feed.find((f) => f.id === itemId) as PlanFeedItem;
    expect(afterFirst.status).not.toBe('awaiting');

    // Un segundo clic en Approve sobre la misma tarjeta no debe lanzar un segundo envío
    executeSteps.mockResolvedValueOnce({ outputs: new Map(), failed: [], skipped: [], waiting: [] });
    await approvePlan(HOME, itemId);
    expect(executeSteps).toHaveBeenCalledTimes(1);
  });

  // FALLO REAL: carried(sessionId) (src/engine/agent/draftActions.ts:10, usado en conversation.ts:135) lee `latestDraft(session.feed)` sin filtrar por agente; si B eligió "Alta calidad" (hq), una petición nueva a A hereda `hq` (1080p desbloqueado) en lugar de "Borrador" (480p).
  it('B confirma vídeo en Alta calidad (hq): una nueva petición a A no debe heredar el modo HQ de B y subir el coste de A', async () => {
    const settingsB: SettingsFeedItem = {
      id: 'set_b',
      createdAt: 1,
      workspace: 'chat',
      type: 'settings',
      status: 'confirmed',
      inline: true,
      draft: draftMode('hq'),
      sections: [{ kind: 'video', count: 1, recommended: { modelRef: 'local::studio-video', needsImage: false, resolution: '1080p' }, chosen: { modelRef: 'local::studio-video', needsImage: false, resolution: '1080p' }, alternatives: [] }],
      meta: { agentNodeId: 'agentB', chatNodeId: 'chat2' },
    };
    useStore.setState((st) => ({
      sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], feed: [settingsB] } },
    }));

    chat.mockImplementationOnce(async (o) => {
      o.onText?.('ok', 'ok');
      return { text: 'ok', toolCalls: [], usage: { inputTokens: 5, outputTokens: 2, costUsd: 0 }, timing: { totalMs: 2 }, finishReason: 'stop' };
    });
    await sendAgentMessage('haz un vídeo de prueba', { agentNodeId: 'agentA', chatNodeId: 'chat1' });

    // A nunca eligió HQ; su draftMode no debe haber copiado `hq` de B
    expect(S().agents.agentA?.draftMode?.kind).not.toBe('hq');
    expect(carried(HOME, 'agentA')).toBeUndefined(); // carried now takes the owner: B's hq does not reach A
  });

  // Ataques que pasan: verifican que los arreglos de 086b815a y 342e3dde cierran esos dos casos.
  it('doble clic simultáneo en approvePlan (nodeRun) ejecuta exactamente una vez', async () => {
    let release!: () => void;
    executeSteps.mockImplementationOnce(() => new Promise((res) => { release = () => res({ outputs: new Map(), failed: [], skipped: [], waiting: [] }); }));
    const card = await presentNodeRun(HOME, ['img1'], 'tc_dbl', { agentNodeId: 'agentA', chatNodeId: 'chat1' }, 'agentA');
    const p1 = approvePlan(HOME, card.itemId!);
    const p2 = approvePlan(HOME, card.itemId!);
    await vi.waitFor(() => expect(typeof release).toBe('function'));
    release();
    await Promise.all([p1, p2]);
    expect(executeSteps).toHaveBeenCalledTimes(1);
  });

  it('reutilizar una aprobación tras fallo temprano dentro del límite del ledger es rechazado como stale', async () => {
    const p = await prepareAction(HOME, ['img1']);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    executeSteps.mockRejectedValueOnce(new Error('early failure'));
    const r1 = await runAction(p.snapshot, 'run-early');
    expect(r1.status).toBe('failed');
    const r2 = await runAction(p.snapshot, 'run-early-2');
    expect(r2.status).toBe('stale');
    expect(executeSteps).toHaveBeenCalledTimes(1);
  });
});
