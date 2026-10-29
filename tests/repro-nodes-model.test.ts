import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));
const execute = vi.hoisted(() => vi.fn());
vi.mock('../src/engine/executor', async (orig) => ({ ...(await orig<typeof import('../src/engine/executor')>()), executeSteps: execute }));
import { estimateSteps } from '../src/engine/executor';
import { opSpec } from '../src/engine/jobs';
import { previewRun, runNodes } from '../src/engine/flow/actions';
import { useStore } from '../src/store/store';
import type { Asset, Generation, ModelSchema, ModelSummary } from '../src/engine/types';

// Repro (case 2): an image operation on a Nodes card whose params._modelRef came from a confirmed plan:
// the model priced in the estimate (executor.ts:87) must be the model that is prepared to run (flow/actions.ts:224-228 -> jobs.ts:1074).
const T2I = 'fal::fal-ai/nano-banana-2';
const EDIT2 = 'fal::fal-ai/nano-banana-2/edit';
const SEED = 'fal::fal-ai/bytedance/seedream/v4/edit';

function install() {
  const st = useStore.getState();
  const model = (ref: string, usd: number, acceptsImage = true): ModelSummary => ({ ref, provider: 'fal', id: ref.slice(5), name: ref.slice(5), kind: 'image', acceptsText: true, acceptsImage, tags: [], price: { skus: [{ usd, unit: 'output' }] } as ModelSummary['price'] });
  const schema = (ref: string, images: boolean): ModelSchema => ({ ref, params: [], source: 'openapi', slots: { prompt: 'prompt', ...(images ? { images: { key: 'image_urls', max: 4, min: 1, multiple: true, format: 'data-url' as const } } : {}) } });
  const asset = (id: string, generationId?: string): Asset => ({ id, kind: 'image', mime: 'image/png', width: 1024, height: 1024, sessionId: 's', generationId, origin: 'generated', stored: true, favorite: false, createdAt: 0 });
  const sid = st.activeSessionId;
  const graph = {
    nodes: [
      { id: 'src', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Made', assetId: 'made' } },
      { id: 'op', position: { x: 300, y: 0 }, data: { kind: 'tool', title: 'Relight', op: 'relight', params: { light: 'golden', from: 'left', intensity: 'medium', _modelRef: SEED }, outputIndex: 0 } },
    ],
    edges: [{ id: 'e', source: 'src', target: 'op', sourceHandle: 'out', targetHandle: 'input' }],
  };
  useStore.setState({
    assets: { made: asset('made', 'g1') },
    generations: { g1: { id: 'g1', modelRef: T2I, status: 'done' } as Generation },
    catalog: { ...st.catalog, models: { [T2I]: model(T2I, 0.08, false), [EDIT2]: model(EDIT2, 0.08), [SEED]: model(SEED, 0.03) }, schemas: { [T2I]: schema(T2I, false), [EDIT2]: schema(EDIT2, true), [SEED]: schema(SEED, true) } },
    settings: { ...st.settings, keys: { ...st.settings.keys, fal: 'k', atlas: '', nanogpt: '' }, ops: { ...st.settings.ops, edit: null } },
    sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: graph as never, feed: [] } },
  });
  return sid;
}

describe('repro 2: estimated model equals executed model (hallazgos H2, nodes.md 5.1)', () => {
  // Cause: flow/actions.ts:224-228 builds nodeChoice from the source asset for non-PICKABLE ops and ignores params._modelRef;
  // jobs.ts:1074 then prefers nodeChoice over params._modelRef, while executor.ts:87 prices params._modelRef.
  it.fails('the model priced for a relight with _modelRef is the model the run is prepared with', async () => {
    const sid = install();
    execute.mockResolvedValue({ outputs: new Map(), failed: [], skipped: [], waiting: [] });
    const priced = estimateSteps(previewRun(sid, ['op']).steps).authorizations.op.modelRef;
    await runNodes(sid, ['op']);
    expect(execute).toHaveBeenCalled();
    const ctx = execute.mock.calls[0][1] as { nodeOperations: Record<string, never> };
    const node = useStore.getState().sessions[sid].graph.nodes.find((n) => n.id === 'op')!.data as { params: Record<string, never> };
    const spec = await opSpec({ sessionId: sid, origin: 'node', sourceAssetId: 'made', op: 'relight', params: node.params, nodeChoice: ctx.nodeOperations.op });
    expect(spec.modelRef).toBe(priced);
  });
});
