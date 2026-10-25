import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));
vi.mock('../src/engine/jobs', async (orig) => ({ ...(await orig<typeof import('../src/engine/jobs')>()), runGeneration: vi.fn(async () => []) }));
import { checkDirect } from '../src/engine/actions';
import { generateDirect } from '../src/engine/actions';
import { previewRun } from '../src/engine/flow/actions';
import { normalizePlan, type PlanContext } from '../src/engine/plan';
import { missing } from '../src/engine/agent/providerFit';
import { useStore } from '../src/store/store';
import type { Asset, Graph, ModelSchema, ModelSummary } from '../src/engine/types';

const videoRef = 'atlas::video-frame-caller-test';
const imageRef = 'atlas::image-frame-caller-test';
const model = { ref: videoRef, provider: 'atlas', id: 'video-frame-caller-test', name: 'Frame caller test', kind: 'video', acceptsText: true, acceptsImage: true, tags: [] } as ModelSummary;
const schema = (frameRules: NonNullable<ModelSchema['slots']['frameRules']>): ModelSchema => ({ ref: videoRef, params: [], source: 'catalog', slots: {
  prompt: 'prompt', firstFrame: { key: 'start', format: 'url' }, lastFrame: { key: 'end', format: 'url' },
  images: { key: 'refs', max: 4, min: 0, multiple: true, format: 'url' }, frameRules,
} });
const asset = (id: string): Asset => ({ id, kind: 'image', name: id, mime: 'image/png', width: 32, height: 32, sessionId: 'test', origin: 'upload', stored: false, favorite: false, createdAt: 0 });
const initial = useStore.getState();

beforeEach(() => {
  const st = useStore.getState();
  useStore.setState({
    assets: { start: asset('start'), end: asset('end'), ref: asset('ref') },
    catalog: { ...st.catalog, models: { ...st.catalog.models, [videoRef]: model }, schemas: { ...st.catalog.schemas, [videoRef]: schema({ lastNeedsFirst: true, firstFrameResolutions: ['720p'] }) } },
    settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'test-key' } },
  });
});
afterEach(() => useStore.setState(initial));

describe('video frame caller wiring', () => {
  it('checkDirect passes an explicit 1080p resolution with its routed start frame', () => {
    const st = useStore.getState();
    useStore.setState({ composer: { ...st.composer, mode: 'video', text: 'move', attachments: ['start'], video: { modelRef: videoRef, settings: { count: 1, resolution: '1080p', advanced: {} } } } });
    expect(checkDirect('video')).toMatchObject({ ok: false, reason: expect.stringMatching(/1080p with a start image/) });
  });

  it('generateDirect keeps storyboard and character as references for a model that forbids an implicit start frame', async () => {
    const st = useStore.getState();
    useStore.setState({ assets: { ...st.assets, subject: asset('subject') }, composer: { ...st.composer, mode: 'video', text: 'move', attachments: ['ref', 'subject'], video: { modelRef: videoRef, settings: { count: 1, resolution: '480p', advanced: {} } } },
      catalog: { ...st.catalog, schemas: { ...st.catalog.schemas, [videoRef]: schema({ refsWithFirst: false, refsWithLast: false }) } } });
    await generateDirect('video');
    const created = Object.values(useStore.getState().generations).find((g) => g.prompt === 'move');
    expect(created?.inputs).toMatchObject({ firstFrame: undefined, refs: ['ref', 'subject'] });
  });

  it('normalizePlan passes an explicit last_frame through the plan check', async () => {
    const context: PlanContext = {
      workspace: 'chat', getModel: async ref => ref === videoRef ? { model, schema: schema({ refsWithFirst: false, refsWithLast: false }) } : null,
      defaultModel: () => null, defaultSettings: () => ({}), asset: () => ({ kind: 'image', width: 32, height: 32 }), layer: () => undefined,
    };
    const result = await normalizePlan({ title: 'Frames', steps: [{ id: 'clip', kind: 'video', prompt: 'move', model: videoRef, last_frame: 'asset:end', refs: ['asset:ref'] }] }, context, 'plan-frames');
    expect(result.errors.join(' ')).toMatch(/reference media with a last frame/);
  });

  it('previewRun passes a graph last-frame input to the preflight validator', () => {
    const st = useStore.getState();
    const sid = st.activeSessionId;
    const node = (id: string, kind: 'image' | 'video', modelRef: string) => ({ id, position: { x: 0, y: 0 }, data: { kind, title: id, prompt: 'move', modelRef, settings: { count: 1, resolution: '1080p', advanced: {} }, outputIndex: 0 } });
    const graph: Graph = {
      nodes: [node('start', 'image', imageRef), node('end', 'image', imageRef), node('clip', 'video', videoRef)] as Graph['nodes'],
      edges: [
        { id: 'start-clip', source: 'start', target: 'clip', sourceHandle: 'out', targetHandle: 'first' },
        { id: 'end-clip', source: 'end', target: 'clip', sourceHandle: 'out', targetHandle: 'last' },
      ],
    };
    useStore.setState({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph } }, catalog: { ...st.catalog,
      models: { ...st.catalog.models, [imageRef]: { ...model, ref: imageRef, id: 'image-frame-caller-test', kind: 'image' } as ModelSummary },
      schemas: { ...st.catalog.schemas, [videoRef]: schema({ lastNeedsFirst: true, firstFrameResolutions: ['720p'] }) },
    } });
    const preview = previewRun(sid, ['clip']);
    expect(preview.errors.join(' ')).toMatch(/1080p with a start image/);
    expect(preview.steps.find(step => step.id === 'clip')).toMatchObject({ firstFrame: 'start', lastFrame: 'end' });
  });

  it('providerFit reports a start frame plus references rejected by frameRules', () => {
    const candidate = schema({ refsWithFirst: false });
    expect(missing(candidate, { startImage: true, images: 1 })).toEqual(['2 images']);
  });
});
