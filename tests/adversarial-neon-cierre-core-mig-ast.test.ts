import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

import '../src/engine/nodecore/migrate';
import { migrateAgents } from '../src/engine/nodecore/migrate';
import { createSession, useStore } from '../src/store/store';
import { applyEdit } from '../src/engine/nodecore/edit';
import { editGraphTool } from '../src/engine/agent/nodeTools';
import { patchNodeData } from '../src/engine/flow/actions';
import { ownerRev } from '../src/engine/nodecore/revision';
import { check as checkGraphWrites } from '../scripts/check-graph-writes.mjs';
import { check as checkAgentOwner } from '../scripts/check-agent-owner.mjs';
import type { AgentState, GenNodeData, Graph, GraphNode, Session } from '../src/engine/types';

const REPO_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname);
const HOME = useStore.getState().activeSessionId;
const S = () => useStore.getState().sessions[HOME];
const tempDirs: string[] = [];

const mkFixture = (prefix: string, code: string) => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(root);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'sample.ts'), code);
  return root;
};

const imgNode = (id: string, extra: Partial<GenNodeData> = {}): GraphNode => ({
  id,
  position: { x: 0, y: 0 },
  data: {
    kind: 'image',
    title: id,
    prompt: 'base',
    modelRef: 'local::studio-image',
    settings: { count: 2, aspect: '1:1', advanced: {} },
    outputIndex: 0,
    ...extra,
  },
});

const refNode = (id: string, type: 'provider' | 'model' | 'chat' | 'agent', ref: string, extra: Record<string, unknown> = {}): GraphNode => ({
  id,
  position: { x: 0, y: 0 },
  data: { kind: 'ref', type, ref, title: id, ...extra } as GraphNode['data'],
});

beforeEach(() => {
  resolveModelMock.mockReset();
  const st = useStore.getState();
  const graph: Graph = {
    nodes: [
      refNode('prov1', 'provider', 'openrouter'),
      refNode('prov2', 'provider', 'fal'),
      refNode('model1', 'model', 'openrouter::img-1', { mediaKind: 'image' }),
      imgNode('srcImg', { generationId: 'gen-multi' }),
      imgNode('tgtImg'),
    ],
    edges: [
      { id: 'e-prov-pinned', source: 'prov1', target: 'model1', sourceHandle: 'provider', targetHandle: 'provider', kind: 'control', pin: 'rev-prov1' },
    ],
  };
  useStore.setState({
    activeSessionId: HOME,
    generations: {
      'gen-multi': {
        id: 'gen-multi',
        sessionId: HOME,
        kind: 'image',
        status: 'done',
        prompt: 'two images',
        modelRef: 'local::studio-image',
        settings: { count: 2, aspect: '1:1', advanced: {} },
        inputs: { refs: [] },
        assetIds: ['a1', 'a2'],
        createdAt: 1,
      } as never,
    },
    assets: {
      a1: { id: 'a1', sessionId: HOME, kind: 'image', origin: 'generated', name: '1.png', width: 512, height: 512, createdAt: 1 } as never,
      a2: { id: 'a2', sessionId: HOME, kind: 'image', origin: 'generated', name: '2.png', width: 512, height: 512, createdAt: 2 } as never,
    },
    sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], graph, feed: [] } },
  });
});

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('adversarial cierre: cables, migración y evasiones AST', () => {
  // FALLO REAL: edit.ts:68,94 compara replacedEdge contra targetHandle sin resolver ('control') en vez del puerto resuelto ('provider'): con targetHandle:null y replaces:null, connect()+withEdge destruyen en silencio el cable fijado existente en un puerto de sistema de cable único.
  it('applyEdit(connect) con targetHandle:null y replaces:null no debe reemplazar silenciosamente un cable ocupado/fijado en un puerto de sistema de cable único', () => {
    const res = applyEdit({
      session: HOME,
      op: { op: 'connect', source: 'prov2', target: 'model1', targetHandle: null, kind: 'control', replaces: null },
    });

    expect(res.ok).toBe(false);
    expect(S().graph.edges.some((e) => e.id === 'e-prov-pinned')).toBe(true);
  });

  // FALLO REAL: graph.ts:209 (y withEdge en graph.ts:190) filtran por (source, target, targetHandle) ignorando sourceHandle, y edit.ts:97 trata sameSource como idempotente: conectar out-2 de un nodo a un puerto multi-entrada (ref) borra silenciosamente el cable out-1 del mismo nodo.
  it('conectar dos salidas distintas (out-1 y out-2) del mismo nodo a un puerto multi-entrada (ref) debe conservar ambos cables', () => {
    const r1 = applyEdit({
      session: HOME,
      op: { op: 'connect', source: 'srcImg', target: 'tgtImg', sourceHandle: 'out-1', targetHandle: 'ref', replaces: null },
    });
    expect(r1.ok).toBe(true);

    const r2 = applyEdit({
      session: HOME,
      op: { op: 'connect', source: 'srcImg', target: 'tgtImg', sourceHandle: 'out-2', targetHandle: 'ref', replaces: null },
    });
    expect(r2.ok).toBe(true);

    const cables = S().graph.edges.filter((e) => e.source === 'srcImg' && e.target === 'tgtImg' && e.targetHandle === 'ref');
    expect(cables).toHaveLength(2);
    expect(cables.map((e) => e.sourceHandle).sort()).toEqual(['out-1', 'out-2']);
  });

  // FALLO REAL: threads.ts:59-60 sobrescribe agents[lastOwner] con raw.agent cuando agentLane es undefined, aunque lastOwner ya exista en raw.agents: si el último mensaje del feed es de agentB, se pierde el historial entero de agentB y agentA queda vacío.
  it('migrateAgents con agent + agents parcial (agentB) y agentLane:undefined no debe sobrescribir agentB aunque el último ítem del feed sea de agentB', () => {
    const sid = 'ses-mig-overwrite';
    const stateA: AgentState = { history: [{ role: 'user', content: 'secreto de A' }], questionRound: 1, notes: ['nota A'], busy: false };
    const stateB: AgentState = { history: [{ role: 'user', content: 'secreto de B' }], questionRound: 2, notes: ['nota B'], busy: false };
    const oldSession = {
      ...createSession('legacy-partial'),
      id: sid,
      graph: {
        nodes: [refNode('chat1', 'chat', sid), refNode('agentA', 'agent', sid), refNode('chat2', 'chat', sid), refNode('agentB', 'agent', sid)],
        edges: [],
      },
      feed: [
        { id: 'f1', createdAt: 1, workspace: 'chat', type: 'user', text: 'msg A', mode: 'agent', attachments: [], meta: { agentNodeId: 'agentA' } },
        { id: 'f2', createdAt: 2, workspace: 'chat', type: 'user', text: 'msg B', mode: 'agent', attachments: [], meta: { agentNodeId: 'agentB' } },
      ],
      agent: stateA,
      agents: { agentB: stateB },
      agentLane: undefined,
    } as unknown as Session;

    const migrated = migrateAgents(oldSession);

    expect(migrated.agents.agentB?.history).toEqual(stateB.history);
    expect(migrated.agents.agentB?.notes).toEqual(['nota B']);
    expect(migrated.agents.agentA?.history).toEqual(stateA.history);
    expect(migrated.agents.agentA?.notes).toEqual(['nota A']);
  });

  // FALLO REAL: scripts/check-agent-owner.mjs:40,57 activa inSettings en cualquier llamada `set(...)` (Zustand) e ignora `agentLane: 'agentB'` por `!plainProp(node)` (Literal/TemplateLiteral/undefined).
  it('check-agent-owner debe detectar escrituras dentro de set(...) y asignaciones de literal en agentLane', () => {
    const root1 = mkFixture('ast-owner-set-', `
      export function sneakySet(set: any, id: string, next: any) {
        set((st: any) => ({
          sessions: { ...st.sessions, [id]: { ...st.sessions[id], agentLane: next, agents: { ...st.sessions[id].agents, main: next } } },
        }));
      }
    `);
    const root2 = mkFixture('ast-owner-literal-', `
      export function sneakyLane(s: any) {
        return { ...s, agentLane: 'agentB' };
      }
    `);

    expect({
      insideSet: checkAgentOwner(root1).length > 0,
      literalLane: checkAgentOwner(root2).length > 0,
    }).toEqual({ insideSet: true, literalLane: true });
  });

  // FALLO REAL: scripts/check-graph-writes.mjs:27,44-45 no detecta mutaciones vía variable/desestructuración (`const { graph } = s; graph.nodes.push(...)`) ni spread de un objeto patch (`const patch = { graph }; ({ ...s, ...patch })`).
  it('check-graph-writes debe detectar mutaciones de graph vía desestructuración y spread de patch separado', () => {
    const root1 = mkFixture('ast-graph-destr-', `
      export function sneakyDestructure(session: any, node: any) {
        const { graph } = session;
        graph.nodes.push(node);
      }
    `);
    const root2 = mkFixture('ast-graph-patch-', `
      export function sneakyPatch(patchSession: any, id: string, nextGraph: any) {
        const patch = { graph: nextGraph };
        patchSession(id, (s: any) => ({ ...s, ...patch }));
      }
    `);

    expect({
      destructuredMutate: checkGraphWrites(root1).length > 0,
      patchSpread: checkGraphWrites(root2).length > 0,
    }).toEqual({ destructuredMutate: true, patchSpread: true });
  });

  // Ataque que pasa: ambos checks AST con el recorrido compartido ast-scan.mjs pasan limpios sobre src/ real.
  it('check-graph-writes y check-agent-owner pasan con 0 errores sobre el src/ actual', () => {
    expect(checkGraphWrites(REPO_ROOT)).toEqual([]);
    expect(checkAgentOwner(REPO_ROOT)).toEqual([]);
  });

  // Ataque que pasa: edit_node con model_ref revalida expect_rev tras await resolveModel y no pisa cambios concurrentes.
  it('edit_node con model_ref rechaza la escritura si el nodo cambió durante await resolveModel', async () => {
    const revBefore = ownerRev(S().graph, 'tgtImg');
    let release!: () => void;
    resolveModelMock.mockImplementationOnce(() => new Promise((res) => {
      release = () => res({
        model: { ref: 'local::studio-image', provider: 'local', id: 'studio-image', name: 'Local', kind: 'image', tags: [], acceptsImage: false, pricing: {} },
        schema: { modelRef: 'local::studio-image', source: 'fetched', params: [], slots: {} },
      });
    }));

    const pending = editGraphTool(HOME, 'edit_node', {
      node_id: 'tgtImg',
      expect_rev: revBefore,
      model_ref: 'local::studio-image',
      prompt: 'agent overwrite',
    });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    patchNodeData(HOME, 'tgtImg', { prompt: 'user edit' });
    release();

    const out = await pending;
    expect(out.text).toMatch(/changed since you read it/i);
    expect((S().graph.nodes.find((n) => n.id === 'tgtImg')?.data as GenNodeData).prompt).toBe('user edit');
  });
});
