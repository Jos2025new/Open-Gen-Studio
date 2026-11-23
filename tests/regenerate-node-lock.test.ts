import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const disk = vi.hoisted(() => ({ raw: undefined as string | undefined }));
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} },
  document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => disk.raw, set: async (_k: string, raw: string | { text(): string }) => { disk.raw = typeof raw === "string" ? raw : raw.text(); }, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => new Blob(['test'], { type: 'image/png' }), putAssetBlob: async () => undefined,
}));
vi.mock('../src/lib/media', async (original) => ({ ...await original<typeof import('../src/lib/media')>(),
  probeMedia: async () => ({ width: 1, height: 1 }) }));

import { useStore } from '../src/store/store';
import { createGeneration } from '../src/engine/jobs';
import { ADAPTERS } from '../src/engine/providers/registry';
import { regenerate } from '../src/engine/actions';
import type { Graph, ModelSummary } from '../src/engine/types';
import { mainThread } from './helpers/threads';

/* A node's Regenerate holds the node while its attempt runs: a second click cannot pay for another one. */
const REF = 'nanogpt::test-image';
const sid = () => useStore.getState().activeSessionId;
let sends = 0;
let release: () => void;

beforeEach(() => {
  sends = 0;
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: [] })));
  const st = useStore.getState();
  const settings = { count: 1, resolution: 'new', advanced: {} };
  useStore.setState({
    generations: {}, quotes: {}, assets: {}, spendLog: [], spentUsd: 0,
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'test-only' }, budgetOn: false },
    catalog: { ...st.catalog, models: { [REF]: { ref: REF, provider: 'nanogpt', id: 'test-image', name: 'Test', kind: 'image', acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] } } as ModelSummary },
      schemas: { [REF]: { ref: REF, params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' } } },
    sessions: { ...st.sessions, [st.activeSessionId]: { ...st.sessions[st.activeSessionId], feed: [], agents: mainThread({ history: [], notes: [], questionRound: 0, busy: false }) } },
  });
  const g = createGeneration({ sessionId: sid(), origin: 'node', kind: 'image', prompt: 'a', modelRef: REF, settings, inputs: { refs: [] } });
  useStore.setState((s) => ({ generations: { ...s.generations, [g.id]: { ...g, status: 'done' } },
    sessions: { ...s.sessions, [sid()]: { ...s.sessions[sid()], graph: { nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'Image', prompt: 'a', modelRef: REF, settings, generationId: g.id } }], edges: [] } as unknown as Graph } } }));
  const gate = new Promise<void>((r) => { release = r; });
  vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementation(async () => { sends++; await gate; return { outputs: [{ blob: new Blob(['i'], { type: 'image/png' }), mime: 'image/png' }], costUsd: 0.1 }; });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Regenerate on a node', () => {
  it('keeps the last result attached until Regenerate finishes, then links the new result', async () => {
    const old = Object.keys(useStore.getState().generations)[0];
    const linked = () => useStore.getState().sessions[sid()].graph.nodes[0].data;
    await regenerate(old);
    await vi.waitFor(() => expect(sends).toBe(1));
    const next = Object.keys(useStore.getState().generations).find(id => id !== old)!;
    const during = linked();
    release();
    await vi.waitFor(() => expect(useStore.getState().generations[next].status).toBe('done'));
    expect(during).toMatchObject({ generationId: old });
    expect(linked()).toMatchObject({ generationId: next });
  });

  it('two clicks while the first attempt runs send once', async () => {
    const gid = Object.keys(useStore.getState().generations)[0];
    const first = regenerate(gid);
    const second = regenerate(gid);
    await vi.waitFor(() => expect(sends).toBeGreaterThan(0));
    release();
    await Promise.all([first, second]);
    await vi.waitFor(() => expect(Object.values(useStore.getState().generations).every((x) => x.status !== 'running' && x.status !== 'queued')).toBe(true));
    expect(sends).toBe(1);
  });
});
