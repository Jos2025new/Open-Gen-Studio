import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { estimateSteps } from '../src/engine/executor';
import { opChoice, opSpec } from '../src/engine/opSpec';
import { costAuthorization } from '../src/engine/priceAuthorization';
import { useStore } from '../src/store/store';
import type { Asset, ModelSchema, ModelSummary } from '../src/engine/types';

/* Review SOLID batch B (Opus #2, third copy): the send, the estimate and the Nodes preview ask one function for the model of an operation. */
const initial = useStore.getState();
const VID = 'atlas::acme/solid-b-i2v';
const model = { ref: VID, provider: 'atlas', id: 'acme/solid-b-i2v', name: 'Solid B i2v', kind: 'video', acceptsText: true, acceptsImage: true, tags: [], price: { skus: [{ usd: 0.1, unit: 'second' }] } } as unknown as ModelSummary;
// 5 or 10 seconds only: a composer duration of 7 s is coerced, and the price follows the coerced one.
const schema: ModelSchema = { ref: VID, source: 'catalog', slots: { prompt: 'prompt', firstFrame: { key: 'image', format: 'url' } as never },
  params: [{ key: 'duration', label: 'Duration', role: 'duration', type: 'enum', options: [5, 10], default: 5 } as never, { key: 'resolution', label: 'Resolution', role: 'resolution', type: 'enum', options: ['720p', '1080p'], default: '720p' } as never] };
const clip: Asset = { id: 'clip', kind: 'video', name: 'clip', mime: 'video/mp4', width: 1280, height: 720, duration: 4, sessionId: 'test', origin: 'generated', stored: false, favorite: false, createdAt: 0 };

beforeEach(() => {
  const st = useStore.getState();
  useStore.setState({
    assets: { clip },
    catalog: { ...st.catalog, models: { ...st.catalog.models, [VID]: model }, schemas: { ...st.catalog.schemas, [VID]: schema } },
    settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'k' } },
    composer: { ...st.composer, video: { ...st.composer.video, settings: { count: 1, duration: 7, resolution: '4K', advanced: {} } } },
  });
});
afterEach(() => useStore.setState(initial));

describe('Opus #2: one choice of the operation model', () => {
  it('Continue shot: the approved price, parameters and model are the sent ones, with coerced settings', async () => {
    const step = { id: 's1', kind: 'op' as const, title: 't', op: 'continue' as const, input: 'asset:clip', params: { _modelRef: VID } };
    const got = estimateSteps([step]);
    const spec = await opSpec({ sessionId: 's', sourceAssetId: 'clip', op: 'continue', params: { _modelRef: VID }, origin: 'op' });
    expect(spec.settings.duration).toBe(5); // 7 s is not offered: coerced
    expect(got.perStep.s1.usd).toBeCloseTo(spec.estimate!.usd!);
    expect(got.authorizations.s1).toEqual(costAuthorization(spec.modelRef, spec.settings, spec.estimate!, got.authorizations.s1.parameters.operationFactor));
  });
  it('opChoice: a picked model wins, then the node choice, then the model that made the source', () => {
    const base = { op: 'continue' as const, params: {}, sourceAssetId: 'clip' };
    expect(opChoice({ ...base, params: { _modelRef: VID } })).toMatchObject({ ref: VID, viaEdit: false });
    expect(opChoice({ ...base, nodeChoice: { ref: 'atlas::other', viaEdit: false } })).toMatchObject({ ref: 'atlas::other' });
    useStore.setState((s) => ({ assets: { clip: { ...s.assets.clip, generationId: 'g1' } as Asset }, generations: { g1: { id: 'g1', modelRef: VID } as never } }));
    expect(opChoice(base).ref).toBe(VID);
  });
  it('a step after a clip still to be made follows that step\'s model (no source asset yet)', () => {
    expect(opChoice({ op: 'continue', params: {}, sourceAssetId: '', upstreamModelRef: VID }).ref).toBe(VID);
  });
});
