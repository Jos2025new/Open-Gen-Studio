import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { rememberView, savedView } from '../src/engine/flow/canvasView';
import { nodeIsCurrent, nodeRequest, stable } from '../src/engine/flow/freshness';
import { previewRun } from '../src/engine/flow/actions';
import { ownerRev } from '../src/engine/nodecore/revision';
import { migrateGraph } from '../src/engine/nodecore/migrate';
import { prepareAction } from '../src/engine/nodecore/action';
import { normalizeAgentTitles } from '../src/engine/nodes/agentNames';
import { migrateAgents } from '../src/engine/agent/threads';
import { assembleText, splitText } from '../src/store/formatV2';
import { mergePersistedState } from '../src/store/mergePersistedState';
import { persistState } from '../src/store/persistJson';
import { currentCopy } from '../src/store/saveRecovery';
import {
  DEFAULT_SETTINGS,
  loadedSession,
  newSession,
  setGraph,
  upsertGeneration,
  useStore,
} from '../src/store/store';
import { looksLost } from '../server/save-guard.js';
import { createStoreV2, exportToFormat1 } from '../server/store-v2.js';
import { createSqliteStore, migrateFromV2 } from '../server/store-sqlite.js';
import { createDeltaClient } from '../server/sqlite/delta-client.mjs';

const A = { x: 145, y: -62, zoom: 0.75 };
const B = { x: -420, y: 110, zoom: 1.4 };
const graphOf = (sid: string) => useStore.getState().sessions[sid].graph;

const tmpDirs: string[] = [];
function makeTmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'ogs-neon-vista-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('Attack 1: silent persistence without updatedAt', () => {
  it('reaches disk (SQLite & store-v2) and restores after reload even though updatedAt does not change', async () => {
    const sid = newSession();
    const initialUpdatedAt = useStore.getState().sessions[sid].updatedAt;
    expect(rememberView(sid, 'nodes', A)).toBe(true);
    expect(rememberView(sid, 'omni', B)).toBe(true);
    expect(useStore.getState().sessions[sid].updatedAt).toBe(initialUpdatedAt);

    const opts = useStore.persist.getOptions();
    const persisted = opts.partialize!(useStore.getState());
    const v2 = persistState({ state: persisted, version: 1 }).v2!;
    const sessionsObj = Object.fromEntries(v2.sessions);

    // SQLite disk round-trip
    const sqliteDir = makeTmpDir();
    const sq = createSqliteStore(sqliteDir);
    const delta = createDeltaClient().diff(v2.globalsObj!, v2.order, v2.order);
    const r1 = sq.commit({ savedAt: 1000, baseAt: 0, version: 1, order: v2.order, sessions: sessionsObj, delta });
    expect(r1.status).toBe(204);
    const diskText = sq.read()!;
    sq.close();

    const parsed = JSON.parse(diskText) as { state: unknown };
    const restored = mergePersistedState(parsed.state, useStore.getState(), DEFAULT_SETTINGS, loadedSession);
    expect(savedView(restored.sessions[sid].graph, 'nodes')).toEqual(A);
    expect(savedView(restored.sessions[sid].graph, 'omni')).toEqual(B);

    // store-v2 disk round-trip
    const v2Dir = makeTmpDir();
    const s2 = createStoreV2(v2Dir);
    const r2 = await s2.commit({ savedAt: 1000, baseAt: 0, version: 1, globals: v2.globals, order: v2.order, sessions: sessionsObj });
    expect(r2.status).toBe(204);
    const v2Read = await s2.read();
    const parsed2 = JSON.parse(v2Read!) as { state: unknown };
    const restored2 = mergePersistedState(parsed2.state, useStore.getState(), DEFAULT_SETTINGS, loadedSession);
    expect(savedView(restored2.sessions[sid].graph, 'nodes')).toEqual(A);
    expect(savedView(restored2.sessions[sid].graph, 'omni')).toEqual(B);
  });

  it('respects baseAt (409 conflict without overwriting another tab) and never triggers looksLost', () => {
    const sid = newSession();
    setGraph(sid, (g) => ({
      ...g,
      nodes: Array.from({ length: 30 }, (_, i) => ({
        id: `n${i}`,
        position: { x: i * 100, y: 0 },
        data: { kind: 'text', title: `Node ${i}`, text: 'x'.repeat(200) } as never,
      })),
    }));
    const opts = useStore.persist.getOptions();
    const baseState = persistState({ state: opts.partialize!(useStore.getState()), version: 1 }).v2!;
    const prevSessionText = baseState.sessions.get(sid)!;
    expect(new TextEncoder().encode(prevSessionText).length).toBeGreaterThan(4096);

    const dir = makeTmpDir();
    const sq = createSqliteStore(dir);
    const dc = createDeltaClient();
    const d1 = dc.diff(baseState.globalsObj!, baseState.order, baseState.order);
    expect(sq.commit({ savedAt: 1000, baseAt: 0, version: 1, order: baseState.order, sessions: Object.fromEntries(baseState.sessions), delta: d1 }).status).toBe(204);
    dc.ack();

    // Another tab saves a real edit at savedAt=2000
    const tabBSession = JSON.stringify({ ...JSON.parse(prevSessionText), title: 'Tab B Work' });
    const d2 = dc.diff(baseState.globalsObj!, baseState.order, [sid]);
    expect(sq.commit({ savedAt: 2000, baseAt: 1000, version: 1, order: baseState.order, sessions: { [sid]: tabBSession }, delta: d2 }).status).toBe(204);
    dc.ack();

    // Stale tab only pans -> 409 conflict, NEVER overwrites Tab B
    rememberView(sid, 'nodes', A);
    rememberView(sid, 'omni', B);
    const pannedState = persistState({ state: opts.partialize!(useStore.getState()), version: 1 }).v2!;
    const pannedSessionText = pannedState.sessions.get(sid)!;
    expect(looksLost(prevSessionText, pannedSessionText)).toBe(false);

    const d3 = dc.diff(pannedState.globalsObj!, pannedState.order, [sid]);
    const conflict = sq.commit({ savedAt: 3000, baseAt: 1000, version: 1, order: pannedState.order, sessions: { [sid]: pannedSessionText }, delta: d3 });
    expect(conflict.status).toBe(409);
    expect(conflict.reason).toBe('conflict');
    const onDisk = JSON.parse(sq.read()!) as { state: { sessions: Record<string, { title: string }> } };
    expect(onDisk.state.sessions[sid].title).toBe('Tab B Work');

    // With current baseAt=2000, view-only commit succeeds (no possible-loss)
    const ok = sq.commit({ savedAt: 3000, baseAt: 2000, version: 1, order: pannedState.order, sessions: { [sid]: pannedSessionText }, delta: d3 });
    expect(ok.status).toBe(204);
    sq.close();
  });

  it('does not trigger freshness, owner revision, run plan signature or approvals', async () => {
    const sid = newSession();
    setGraph(sid, (g) => ({
      ...g,
      nodes: [
        { id: 't1', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'Prompt', text: 'red apple' } as never },
        {
          id: 'img1',
          position: { x: 300, y: 0 },
          data: {
            kind: 'image',
            title: 'Image',
            prompt: '',
            modelRef: 'local::sketch',
            settings: { aspect: '1:1', resolution: '1K', count: 1, advanced: {} },
            generationId: 'gen_1',
          } as never,
        },
      ],
      edges: [{ id: 'e1', source: 't1', target: 'img1', sourceHandle: 'out', targetHandle: 'prompt' }],
    }));
    const req = nodeRequest(graphOf(sid), graphOf(sid).nodes[1], {});
    upsertGeneration({
      id: 'gen_1',
      sessionId: sid,
      kind: 'image',
      modelRef: 'local::sketch',
      prompt: 'red apple',
      settings: { aspect: '1:1', resolution: '1K', count: 1, advanced: {} },
      status: 'done',
      assetIds: ['ast_1'],
      createdAt: 1,
      inputs: { refs: [] },
      nodeRequest: stable(req),
    } as never);

    const revBefore = ownerRev(graphOf(sid), 'img1');
    const currentBefore = nodeIsCurrent(graphOf(sid), graphOf(sid).nodes[1], useStore.getState().generations);
    const previewBefore = previewRun(sid, ['img1'], true);
    const appr = await prepareAction(sid, ['img1'], true);
    expect(currentBefore).toBe(true);
    expect(appr.ok).toBe(true);

    rememberView(sid, 'nodes', A);
    rememberView(sid, 'omni', B);

    expect(ownerRev(graphOf(sid), 'img1')).toBe(revBefore);
    expect(nodeIsCurrent(graphOf(sid), graphOf(sid).nodes[1], useStore.getState().generations)).toBe(true);
    expect(previewRun(sid, ['img1'], true).signature).toBe(previewBefore.signature);
  });
});

describe('Attack 2: graph.omniViewport validation, migration, export/import, copies', () => {
  it('survives validation, descriptor/agent/title migrations, v2->SQLite migration, exportToFormat1 and currentCopy', async () => {
    const sid = newSession();
    setGraph(sid, (g) => ({
      ...g,
      nodes: [
        { id: 'a1', position: { x: 0, y: 0 }, data: { kind: 'ref', type: 'agent', ref: sid, title: 'Agent' } as never },
        { id: 'a2', position: { x: 100, y: 0 }, data: { kind: 'ref', type: 'agent', ref: sid, title: 'Agent' } as never },
      ],
    }));
    rememberView(sid, 'nodes', A);
    rememberView(sid, 'omni', B);

    const s = useStore.getState().sessions[sid];
    expect(migrateGraph(s.graph).omniViewport).toEqual(B);
    expect(normalizeAgentTitles(s.graph).omniViewport).toEqual(B);
    expect(migrateAgents(s).graph.omniViewport).toEqual(B);

    const opts = useStore.persist.getOptions();
    const persisted = opts.partialize!(useStore.getState());
    const v2 = persistState({ state: persisted, version: 1 }).v2!;
    const sessionsObj = Object.fromEntries(v2.sessions);
    const text = assembleText({ savedAt: 1000, version: 1, globals: v2.globals, order: v2.order, sessions: v2.sessions });
    const reSplit = splitText(text);
    expect(JSON.parse(reSplit.sessions.get(sid)!).graph.omniViewport).toEqual(B);

    const dir = makeTmpDir();
    const s2 = createStoreV2(dir);
    expect((await s2.commit({ savedAt: 1000, baseAt: 0, version: 1, globals: v2.globals, order: v2.order, sessions: sessionsObj })).status).toBe(204);
    const exp = await exportToFormat1(dir);
    expect(exp.exported).toBe(true);
    const mig = await migrateFromV2(dir);
    expect(mig.ok).toBe(true);
    const sq = createSqliteStore(dir);
    const sqState = JSON.parse(sq.read()!) as { state: { sessions: Record<string, { graph: { omniViewport?: unknown } }> } };
    sq.close();
    expect(sqState.state.sessions[sid].graph.omniViewport).toEqual(B);

    const copy = currentCopy() as { sessions: Record<string, { graph: { omniViewport?: unknown } }> };
    expect(copy.sessions[sid].graph.omniViewport).toEqual(B);
  });

  it('safely rejects malformed omniViewport values without crashing', () => {
    const base = { nodes: [], edges: [] };
    for (const bad of [null, {}, { x: NaN, y: 0, zoom: 1 }, { x: 0, y: 0, zoom: 0 }, { x: 0, y: 0, zoom: -2 }, { x: '1', y: 2, zoom: 1 }]) {
      expect(savedView({ ...base, omniViewport: bad as never }, 'omni')).toBeUndefined();
    }
  });
});
