import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
const resolveModelMock = vi.hoisted(() => vi.fn());
vi.mock('../src/engine/catalog', async (orig) => {
  const actual = await orig<typeof import('../src/engine/catalog')>();
  return { ...actual, resolveModel: (...args: unknown[]) => resolveModelMock(...args) };
});

import { useStore } from '../src/store/store';
import { editGraphTool } from '../src/engine/agent/nodeTools';
import { patchNodeData } from '../src/engine/flow/actions';
import { ownerRev } from '../src/engine/nodecore/revision';
import { editCompound } from '../src/engine/nodecore/edit';
import { lockAssets } from '../src/engine/flow/locks';
import { deleteGeneration } from '../src/engine/actions';
import { NO_RESULT } from '../src/engine/flow/graph';
import { check as checkGraphWrites } from '../scripts/check-graph-writes.mjs';
import { check as checkAgentOwner } from '../scripts/check-agent-owner.mjs';
import type { Asset, GenNodeData, Generation, Graph, GraphNode } from '../src/engine/types';

const HOME = useStore.getState().activeSessionId;
const S = () => useStore.getState().sessions[HOME];
const textNode = (id: string, text: string): GraphNode => ({ id, position: { x: 0, y: 0 }, data: { kind: 'text', title: id, text } });
const imgNode = (id: string, extra: Partial<GenNodeData> = {}): GraphNode => ({
  id,
  position: { x: 200, y: 0 },
  data: { kind: 'image', title: id, prompt: 'initial prompt', modelRef: 'local::studio-image', settings: { count: 1, aspect: '1:1', advanced: {} }, outputIndex: 0, ...extra },
});

const mkFixture = (prefix: string, code: string) => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'sample.ts'), code);
  return root;
};

beforeEach(() => {
  resolveModelMock.mockReset();
  const st = useStore.getState();
  const graph: Graph = {
    nodes: [textNode('t1', 'uno'), textNode('t2', 'dos'), imgNode('img1'), imgNode('img2')],
    edges: [{ id: 'e1', source: 't1', target: 'img1', sourceHandle: 'out', targetHandle: 'prompt', kind: 'data', pin: 'rev-fixed' }],
  };
  useStore.setState({
    activeSessionId: HOME,
    generations: {},
    assets: {},
    sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], graph, feed: [] } },
  });
});

describe('adversarial: conexiones, núcleo, deleteGeneration y checks AST', () => {
  // FALLO REAL: edit_node (src/engine/agent/nodeTools.ts:17-34) comprueba `expect_rev` ANTES de `await resolveModel(modelRef)` y luego llama `setNodeModel`/`patchNodeData` sin pasar `expect`, sobrescribiendo ediciones concurrentes del usuario.
  it('edit_node con `model_ref`: una edición concurrente del usuario durante `await resolveModel` debe provocar rechazo por `expect_rev` y no sobrescribirse', async () => {
    const revBefore = ownerRev(S().graph, 'img1')!;
    let releaseResolve!: () => void;
    resolveModelMock.mockImplementationOnce(() => new Promise((res) => {
      releaseResolve = () => res({
        model: { ref: 'local::studio-image', provider: 'local', id: 'studio-image', name: 'Local', kind: 'image', tags: [], acceptsImage: false, pricing: {} },
        schema: { modelRef: 'local::studio-image', source: 'fetched', params: [], slots: {} },
      });
    }));

    const pendingEdit = editGraphTool(HOME, 'edit_node', {
      node_id: 'img1',
      expect_rev: revBefore,
      model_ref: 'local::studio-image',
      settings: { aspect: '16:9' },
      prompt: 'agente pisa al usuario',
    });
    await vi.waitFor(() => expect(typeof releaseResolve).toBe('function'));

    // Mientras resolveModel está en vuelo, el usuario edita el prompt del mismo nodo
    patchNodeData(HOME, 'img1', { prompt: 'edición del usuario que no debe perderse' });
    releaseResolve();
    const res = await pendingEdit;

    expect(res.text).toMatch(/changed since/i);
    expect((S().graph.nodes.find((n) => n.id === 'img1')!.data as { prompt: string }).prompt).toBe('edición del usuario que no debe perderse');
  });

  // FALLO REAL: connectNodesSchema (src/engine/agent/tools.ts:19) acepta cualquier string en `replaces` y replaceConflict (src/engine/nodecore/edit.ts:105) trata `'any'` como comodín; el agente puede pasar `replaces: "any"` y pisar un cable ocupado o fijado (`pin`) sin conocer su id.
  it('connect_nodes con `replaces: "any"` no debe burlar la protección y pisar un cable ocupado/fijado a ciegas', async () => {
    const res = await editGraphTool(HOME, 'connect_nodes', { source: 't2', target: 'img1', port: 'prompt', replaces: 'any' });
    expect(res.text).not.toContain('Connected');
    expect(S().graph.edges.find((e) => e.id === 'e1')?.source).toBe('t1');
  });

  // FALLO REAL: deleteGeneration (src/engine/actions.ts:516-539) no comprueba `assetsInUse(assetIds)` (al contrario que `deleteAssets` en actions.ts:544) y borra la generación, sus assets y blobs aunque un flujo en ejecución los tenga bloqueados con `lockAssets`.
  it('deleteGeneration sobre assets bloqueados por un flujo en ejecución (`lockAssets`) debe rechazar el borrado igual que `deleteAssets`', () => {
    const gen: Generation = {
      id: 'gen_live', sessionId: HOME, origin: 'node', kind: 'image', modelName: 'Local', provider: 'local',
      prompt: 'test', modelRef: 'local::studio-image', settings: { count: 1, advanced: {} },
      inputs: { refs: [] }, status: 'done', assetIds: ['as_live'], estimate: { usd: 0, approximate: false }, createdAt: 1,
    };
    const asset: Asset = { id: 'as_live', sessionId: HOME, kind: 'image', origin: 'generated', mime: 'image/png', width: 512, height: 512, stored: true, favorite: false, createdAt: 1, generationId: 'gen_live' };
    useStore.setState((st) => ({
      generations: { gen_live: gen },
      assets: { as_live: asset },
      sessions: {
        ...st.sessions,
        [HOME]: {
          ...st.sessions[HOME],
          graph: {
            ...st.sessions[HOME].graph,
            nodes: st.sessions[HOME].graph.nodes.map((n) => (n.id === 'img1' ? { ...n, data: { ...n.data, generationId: 'gen_live' } } : n)),
          },
        },
      },
    }));

    const release = lockAssets(['as_live']);
    try {
      deleteGeneration('gen_live');
      expect(useStore.getState().generations.gen_live).toBeDefined();
      expect(useStore.getState().assets.as_live).toBeDefined();
    } finally {
      release();
    }
  });

  // FALLO REAL: deleteGeneration (src/engine/actions.ts:520) limpia `node.data.generationId` pero no marca como `NO_RESULT` los cables fijados por `outputIndex` (a diferencia de `dropResults.ts:37-45` en `deleteAssets`); al regenerar el nodo, el cable salta silenciosamente a otro resultado.
  it('deleteGeneration de una generación multi-salida debe invalidar (`NO_RESULT`) los cables fijados a un `outputIndex` concreto', () => {
    const gen: Generation = {
      id: 'gen_multi', sessionId: HOME, origin: 'node', kind: 'image', modelName: 'Local', provider: 'local',
      prompt: 'two cats', modelRef: 'local::studio-image', settings: { count: 2, advanced: {} },
      inputs: { refs: [] }, status: 'done', assetIds: ['a0', 'a1'], estimate: { usd: 0, approximate: false }, createdAt: 1,
    };
    const a0: Asset = { id: 'a0', sessionId: HOME, kind: 'image', origin: 'generated', mime: 'image/png', width: 512, height: 512, stored: true, favorite: false, createdAt: 1, generationId: 'gen_multi' };
    const a1: Asset = { id: 'a1', sessionId: HOME, kind: 'image', origin: 'generated', mime: 'image/png', width: 512, height: 512, stored: true, favorite: false, createdAt: 1, generationId: 'gen_multi' };
    useStore.setState((st) => ({
      generations: { gen_multi: gen },
      assets: { a0, a1 },
      sessions: {
        ...st.sessions,
        [HOME]: {
          ...st.sessions[HOME],
          graph: {
            nodes: [imgNode('img1', { generationId: 'gen_multi', outputIndex: 1 }), imgNode('img2')],
            edges: [{ id: 'e_out1', source: 'img1', target: 'img2', sourceHandle: 'out-1', targetHandle: 'ref', kind: 'data', outputIndex: 1 }],
          },
        },
      },
    }));

    deleteGeneration('gen_multi');
    const edge = S().graph.edges.find((e) => e.id === 'e_out1')!;
    expect(edge.outputIndex).toBe(NO_RESULT);
  });

  // FALLO REAL: compoundProblem (src/engine/nodecore/edit.ts:124) solo verifica que exista un cable con el mismo `id` y permite recablear `source`/`target` en sitio sin `dropped` ni validación.
  it('editCompound no debe permitir recablear un cable existente (cambiar `source` manteniendo el mismo `id`) sin declararlo en `dropped`', () => {
    const err = editCompound(HOME, 'silent-rewire', (g) => ({
      ...g,
      edges: g.edges.map((e) => (e.id === 'e1' ? { ...e, source: 't2' } : e)),
    }));
    expect(err).not.toBeNull();
    expect(S().graph.edges.find((e) => e.id === 'e1')?.source).toBe('t1');
  });

  // FALLO REAL: check-graph-writes.mjs (scripts/check-graph-writes.mjs:40-47) se burla con mutación directa (`session.graph.nodes.push`), `Object.assign({}, session, { graph })` y alias de import (`import { setGraph as sg }`).
  it('check-graph-writes por AST debe detectar mutaciones directas, Object.assign y alias de setGraph', () => {
    const r1 = mkFixture('ogs-gw-mut-', 'export function bad(session: any, n: any) { session.graph.nodes.push(n); }');
    const r2 = mkFixture('ogs-gw-oa-', 'export function bad(session: any, g: any) { return Object.assign({}, session, { graph: g }); }');
    const r3 = mkFixture('ogs-gw-alias-', "import { setGraph as sg } from './store';\nexport function bad(id: string) { sg(id, (g: any) => g); }");

    expect(checkGraphWrites(r1).length).toBeGreaterThan(0);
    expect(checkGraphWrites(r2).length).toBeGreaterThan(0);
    expect(checkGraphWrites(r3).length).toBeGreaterThan(0);
  });

  // FALLO REAL: check-agent-owner.mjs (scripts/check-agent-owner.mjs:53-69) sigue mirando solo `.agent` (ya borrado del tipo Session) y deja pasar escrituras directas sobre `session.agents[s.agentLane]` (el formato actual), desestructuración y nombres de variable fuera de SESSION_NAMES.
  it('check-agent-owner por AST debe detectar escrituras/lecturas sin dueño sobre el nuevo `session.agents[s.agentLane]` y desestructuración', () => {
    const r1 = mkFixture('ogs-ao-agents-', 'export function bad(s: any) { return { ...s, agents: { ...s.agents, [s.agentLane]: { ...s.agents[s.agentLane], busy: true } } }; }');
    const r2 = mkFixture('ogs-ao-mut-', 'export function bad(s: any) { s.agents[s.agentLane].busy = true; }');
    const r3 = mkFixture('ogs-ao-destr-', 'export function bad(mySess: any) { const { agent } = mySess; return agent.busy; }');

    expect(checkAgentOwner(r1).length).toBeGreaterThan(0);
    expect(checkAgentOwner(r2).length).toBeGreaterThan(0);
    expect(checkAgentOwner(r3).length).toBeGreaterThan(0);
  });

  // Ataque que pasa: edit_node sin expect_rev o con expect_rev viejo sí es rechazado cuando no hay carrera async.
  it('edit_node síncrono rechaza falta de expect_rev y rev obsoleto', async () => {
    const noRev = await editGraphTool(HOME, 'edit_node', { node_id: 't1', prompt: 'x' });
    expect(noRev.text).toMatch(/expect_rev/);
    const oldRev = ownerRev(S().graph, 't1')!;
    patchNodeData(HOME, 't1', { text: 'cambiado' } as never);
    const stale = await editGraphTool(HOME, 'edit_node', { node_id: 't1', prompt: 'x', expect_rev: oldRev });
    expect(stale.text).toMatch(/changed since/);
  });
});
