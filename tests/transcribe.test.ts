import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nanoSnapshot from './fixtures/live/nanogpt.json';
import { createGeneration, opSpec, runGeneration } from '../src/engine/jobs';
import { graphToSteps } from '../src/engine/flow/graph';
import { JobFailedError } from '../src/lib/http';
import { nanogpt } from '../src/engine/providers/nanogpt';
import { useStore } from '../src/store/store';
import { estimateTranscribe } from '../src/engine/costs';
import type { Asset, Generation, Graph, TranscriberSummary } from '../src/engine/types';

// Node lacks the browser pieces the runner touches: window timers and IndexedDB.
const fakeWindow = vi.hoisted(() => {
  const w = { setTimeout, clearTimeout, addEventListener: () => undefined };
  Object.assign(globalThis, { window: w, document: { addEventListener: () => undefined, visibilityState: 'visible' } });
  return w;
});
const blobs = new Map<string, Blob>();
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async (id: string) => blobs.get(id),
  putAssetBlob: async (id: string, b: Blob) => (blobs.set(id, b), id),
}));

type Loose = any;
const nanoAudio = (nanoSnapshot as Loose).audio;

beforeEach(() => vi.stubGlobal('location', { href: 'http://localhost/' }));
afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(globalThis, { window: fakeWindow });
});

async function whisper(): Promise<TranscriberSummary> {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: nanoAudio })));
  const list = await nanogpt.listTranscribers!();
  vi.unstubAllGlobals();
  vi.stubGlobal('location', { href: 'http://localhost/' });
  return list.find((m) => m.id === 'Whisper-Large-V3')!;
}

function install(t: TranscriberSummary, bytes = 64) {
  const clip: Asset = { id: 'voice', kind: 'audio', mime: 'audio/mpeg', width: 0, height: 0, duration: 90, sessionId: 's', origin: 'upload', stored: true, favorite: false, createdAt: 0 } as Asset;
  blobs.set('voice', new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' }));
  const st = useStore.getState();
  useStore.setState({
    assets: { voice: clip },
    catalog: { ...st.catalog, transcribers: { [t.ref]: t } },
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, ops: { ...st.settings.ops, transcribe: null } },
  });
}

describe('speech-to-text (NanoGPT /api/transcribe)', () => {
  it('lists transcribers without voice-clone models, the user-chosen ones first by default', async () => {
    const t = await whisper();
    expect(t).toMatchObject({ ref: 'nanogpt::Whisper-Large-V3', usdPerMinute: 0.000495, maxDirectBytes: 3 * 1024 * 1024 });
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: nanoAudio })));
    expect((await nanogpt.listTranscribers!()).some((m) => /voice-clone/.test(m.id))).toBe(false);
  });

  it('transcribes an audio asset into text, priced per minute', async () => {
    install(await whisper());
    let form: FormData | undefined;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/transcribe')) {
        form = init?.body as FormData;
        return new Response(JSON.stringify({ transcription: 'hola mundo', metadata: { cost: 0.0008 } }));
      }
      throw new Error(`unexpected ${url}`);
    });
    const spec = await opSpec({ sessionId: 's', sourceAssetId: 'voice', op: 'transcribe', params: { language: 'es' }, origin: 'op' });
    expect(spec).toMatchObject({ kind: 'text', modelRef: 'nanogpt::Whisper-Large-V3' });
    expect(spec.estimate?.usd).toBe(0.0007); // 90 s at $0.000495/min, rounded like every estimate
    const g = createGeneration(spec);
    await runGeneration(g.id);
    expect(useStore.getState().generations[g.id]).toMatchObject({ status: 'done', text: 'hola mundo', actualUsd: 0.0008, assetIds: [] });
    expect(form?.get('model')).toBe('Whisper-Large-V3');
    expect(form?.get('language')).toBe('es');
    expect((form?.get('audio') as File).name).toBe('input.mp3');
  });

  it('follows an async job (202) and keeps it for resuming', async () => {
    const t = await whisper();
    const jobs: unknown[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/transcribe')) return new Response(JSON.stringify({ runId: 'r1', status: 'pending', cost: 0.02, paymentSource: 'USD' }), { status: 202 });
      if (url.endsWith('/api/transcribe/status')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ runId: 'r1', cost: 0.02, paymentSource: 'USD', isApiRequest: true });
        return new Response(JSON.stringify({ status: 'completed', diarization: { segments: [{ speaker: 'A', text: 'hi' }, { speaker: 'B', text: 'hello' }] } }));
      }
      throw new Error(`unexpected ${url}`);
    });
    const input = { assetId: 'v', blob: new Blob([new Uint8Array(4)], { type: 'audio/wav' }), mime: 'audio/wav', width: 0, height: 0 };
    const res = await nanogpt.transcribe!({ model: t, input, language: 'auto', apiKey: 'k', signal: new AbortController().signal, onStatus: () => undefined, onRemoteJob: (j) => jobs.push(j) });
    expect(jobs).toEqual([{ provider: 'nanogpt', id: 'r1', meta: { kind: 'transcribe', cost: '0.02', paymentSource: 'USD' } }]);
    expect(res).toMatchObject({ text: 'A: hi\nB: hello', costUsd: 0.02 });
  });

  it('reports a failed job as confirmed and refuses big files before sending [AUDIO_TOO_LARGE]', async () => {
    const t = await whisper();
    vi.stubGlobal('fetch', async (url: string) =>
      url.endsWith('/status') ? new Response(JSON.stringify({ status: 'failed', error: 'bad audio' })) : new Response(JSON.stringify({ runId: 'r2', status: 'pending' }), { status: 202 }),
    );
    const input = { assetId: 'v', blob: new Blob([new Uint8Array(4)], { type: 'audio/wav' }), mime: 'audio/wav', width: 0, height: 0 };
    await expect(nanogpt.transcribe!({ model: t, input, language: 'auto', apiKey: 'k', signal: new AbortController().signal, onStatus: () => undefined, onRemoteJob: () => undefined })).rejects.toBeInstanceOf(JobFailedError);

    install(t, 4 * 1024 * 1024);
    const send = vi.fn();
    vi.stubGlobal('fetch', send);
    const g = createGeneration(await opSpec({ sessionId: 's', sourceAssetId: 'voice', op: 'transcribe', params: { language: 'auto' }, origin: 'op' }));
    await expect(runGeneration(g.id)).rejects.toThrow(/\[AUDIO_TOO_LARGE\]/);
    expect(send).not.toHaveBeenCalled();
  });

  it('never prices a paid transcription as free', () => {
    expect(estimateTranscribe(0.000495, 3)).toMatchObject({ usd: 0.0001, approximate: true });
    expect(estimateTranscribe(undefined, 3).usd).toBeNull();
  });

  it('feeds a finished transcription into a Prompt port', () => {
    const graph: Graph = {
      nodes: [
        { id: 'tr', position: { x: 0, y: 0 }, data: { kind: 'tool', title: 'Transcribe', op: 'transcribe', params: {}, generationId: 'gt', outputIndex: 0 } },
        { id: 'img', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'Image', prompt: '', modelRef: 'local::studio-image', settings: { count: 1, advanced: {} }, outputIndex: 0 } },
      ],
      edges: [{ id: 'e', source: 'tr', target: 'img', sourceHandle: 'out', targetHandle: 'prompt' }],
    } as Graph;
    const gens = { gt: { id: 'gt', kind: 'text', status: 'done', text: 'a lighthouse at dawn', assetIds: [] } as unknown as Generation };
    const run = graphToSteps(graph, ['img'], gens);
    expect(run.errors).toEqual([]);
    expect(run.steps).toContainEqual(expect.objectContaining({ id: 'tr', kind: 'text', text: 'a lighthouse at dawn' }));
    expect(run.steps.find((s) => s.id === 'img')).toMatchObject({ promptFrom: 'tr' });
  });
});
