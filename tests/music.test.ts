import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import atlasSnapshot from './fixtures/live/atlas.json';
import { lyricsBody, lyricsParam, songProblem, wireParams } from '../src/engine/params';
import { normalizePlan, type PlanContext } from '../src/engine/plan';
import { createGeneration, runGeneration } from '../src/engine/jobs';
import { executeSteps } from '../src/engine/executor';
import { checkDirect } from '../src/engine/actions';
import { graphToSteps, outputPort, planToGraph } from '../src/engine/flow/graph';
import { atlas, lyricsText } from '../src/engine/providers/atlas';
import { useStore } from '../src/store/store';
import type { Generation, GenSettings, Graph, ModelSchema, ModelSummary } from '../src/engine/types';

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
const MUSIC = 'atlas::minimax/music-3.0';
const LYRICS = 'atlas::minimax/lyrics-generation';

/** The two MiniMax models as the real adapter lists and parses them from the live snapshot. */
async function catalog(): Promise<{ models: Record<string, ModelSummary>; schemas: Record<string, ModelSchema> }> {
  const A = atlasSnapshot as Loose;
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.endsWith('/api/v1/models')) return new Response(JSON.stringify({ data: A.models }));
    const doc = A.models.find((m: Loose) => m.schema === url || url.endsWith(new URL(m.schema ?? 'https://x/none').pathname))?.schemaDoc;
    if (doc) return new Response(JSON.stringify(doc));
    throw new Error(`unexpected ${url}`);
  });
  const listed = await atlas.listModels(undefined);
  const models: Record<string, ModelSummary> = {};
  const schemas: Record<string, ModelSchema> = {};
  for (const ref of [MUSIC, LYRICS]) {
    const m = listed.find((x) => x.ref === ref)!;
    models[ref] = m;
    schemas[ref] = await atlas.loadSchema(m, undefined);
  }
  vi.unstubAllGlobals();
  vi.stubGlobal('location', { href: 'http://localhost/' });
  return { models, schemas };
}

async function install() {
  const c = await catalog();
  const st = useStore.getState();
  useStore.setState({
    assets: {},
    generations: {},
    catalog: { ...st.catalog, models: c.models, schemas: c.schemas },
    settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'k' } },
  });
  return c;
}

const song = (extras: Record<string, unknown> = {}, advanced: GenSettings['advanced'] = {}): GenSettings => ({ count: 1, advanced, extras });

beforeEach(() => vi.stubGlobal('location', { href: 'http://localhost/' }));
afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(globalThis, { window: fakeWindow });
});

describe('MiniMax music and lyrics (Atlas)', () => {
  it('lists Music as audio and Lyrics as audio with a text output; lyrics are a text area with section tags', async () => {
    const { models, schemas } = await catalog();
    expect(models[MUSIC]).toMatchObject({ kind: 'audio', acceptsText: true, acceptsImage: false });
    expect(models[MUSIC].textOutput).toBeUndefined();
    expect(models[LYRICS]).toMatchObject({ kind: 'audio', textOutput: true });
    expect(models[MUSIC].price?.skus[0]).toMatchObject({ unit: 'output', usd: 0.15 });
    const lyrics = lyricsParam(schemas[MUSIC])!;
    expect(lyrics).toMatchObject({ key: 'lyrics', type: 'text', multiline: true, max: 3500 });
    expect(lyrics.tags).toContain('[Chorus]');
    // Raw PCM cannot be played or measured in the browser.
    expect(schemas[MUSIC].params.find((p) => p.key === 'format')?.options).toEqual(['mp3', 'wav']);
    // Lyrics keep their line breaks and lose only the outer blank space on the wire.
    expect(wireParams(schemas[MUSIC], song({ lyrics: '\n[Verse]\nla la\n\n[Chorus]\noh \n' }), 1)).toMatchObject({ lyrics: '[Verse]\nla la\n\n[Chorus]\noh' });
  });

  it('checks the published request rules before sending, with a code for each', async () => {
    const { schemas } = await catalog();
    const music = schemas[MUSIC];
    const lyrics = schemas[LYRICS];
    expect(songProblem(music, 'pop', song())?.code).toBe('LYRICS_MISSING');
    expect(songProblem(music, 'pop', song({ lyrics: '[Verse]\nhi' }))).toBeNull();
    expect(songProblem(music, '', song({}, { is_instrumental: true }))?.code).toBe('PROMPT_MISSING');
    expect(songProblem(music, 'lofi', song({}, { is_instrumental: true }))).toBeNull();
    expect(songProblem(music, 'pop', song({ lyrics: 'mine' }, { lyrics_optimizer: true }))?.code).toBe('LYRICS_CONFLICT');
    expect(songProblem(music, 'pop', song({}, { lyrics_optimizer: true }))).toBeNull();
    expect(songProblem(music, 'pop', song({ lyrics: 'x'.repeat(3501) }))?.code).toBe('LYRICS_TOO_LONG');
    expect(songProblem(lyrics, 'summer', song())).toBeNull();
    expect(songProblem(lyrics, 'summer', song({ lyrics: 'old' }))?.code).toBe('LYRICS_CONFLICT');
    expect(songProblem(lyrics, 'fix it', song({}, { mode: 'edit' }))?.code).toBe('LYRICS_MISSING');
    expect(songProblem(lyrics, 'fix it', song({ lyrics: 'old' }, { mode: 'edit' }))).toBeNull();
  });

  it('generates a song into an audio asset through /model/generateAudio', async () => {
    await install();
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/model/generateAudio')) {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ data: { id: 'm1', urls: { get: 'https://api.atlascloud.ai/api/v1/model/prediction/m1' } } }));
      }
      if (url.endsWith('/prediction/m1')) return new Response(JSON.stringify({ data: { status: 'completed', outputs: ['https://cdn.test/song.mp3'] } }));
      if (url === 'https://cdn.test/song.mp3') return new Response(new Uint8Array(8), { headers: { 'content-type': 'audio/mpeg' } });
      throw new Error(`unexpected ${url}`);
    });
    const g = createGeneration({ sessionId: 's', kind: 'audio', prompt: 'upbeat pop, 120bpm', modelRef: MUSIC, settings: song({ lyrics: '[Verse]\nsun on the sea' }), origin: 'composer' });
    expect(g.estimate).toMatchObject({ usd: 0.15 });
    const [assetId] = await runGeneration(g.id);
    expect(body).toMatchObject({ model: 'minimax/music-3.0', prompt: 'upbeat pop, 120bpm', lyrics: '[Verse]\nsun on the sea' });
    expect(body).not.toHaveProperty('is_instrumental');
    expect(useStore.getState().assets[assetId]).toMatchObject({ kind: 'audio', mime: 'audio/mpeg', width: 0, height: 0, stored: true });
  });

  it('writes lyrics as a text result, priced like the model', async () => {
    await install();
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/model/generateAudio')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'minimax/lyrics-generation', prompt: 'a seaside promise' });
        return new Response(JSON.stringify({ data: { id: 'l1' } }));
      }
      if (url.endsWith('/prediction/l1')) {
        return new Response(JSON.stringify({ data: { status: 'completed', outputs: [], lyrics_result: { song_title: 'Tide', style_tags: ['Pop', 'Summer'], lyrics: '[Verse]\nwaves\n\n[Chorus]\nstay' } } }));
      }
      throw new Error(`unexpected ${url}`);
    });
    const g = createGeneration({ sessionId: 's', kind: 'text', prompt: 'a seaside promise', modelRef: LYRICS, settings: song(), origin: 'composer' });
    expect(g.estimate).toMatchObject({ usd: 0.01 });
    expect(await runGeneration(g.id)).toEqual([]);
    const done = useStore.getState().generations[g.id];
    expect(done).toMatchObject({ status: 'done', text: '# Tide\nStyle: Pop, Summer\n\n[Verse]\nwaves\n\n[Chorus]\nstay', assetIds: [] });
    expect(lyricsBody(done.text!)).toBe('[Verse]\nwaves\n\n[Chorus]\nstay');
    expect(lyricsBody('[Verse]\nonly lyrics')).toBe('[Verse]\nonly lyrics');
    expect(lyricsText({ lyrics: 'x' })).toBe('x');
  });

  it('resumes a lyrics job after a reload as text', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url === 'https://api.atlascloud.ai/api/v1/model/prediction/l9') return new Response(JSON.stringify({ data: { status: 'completed', lyrics_result: { lyrics: '[Verse]\nback' } } }));
      throw new Error(`unexpected ${url}`);
    });
    const res = await atlas.resume!({ provider: 'atlas', id: 'l9', meta: {} }, { kind: 'text', apiKey: 'k', signal: new AbortController().signal, onStatus: () => undefined });
    expect(res).toMatchObject({ outputs: [], text: '[Verse]\nback' });
  });

  it('checks Audio mode in the composer like the runner', async () => {
    await install();
    const st = useStore.getState();
    const set = (modelRef: string, settings: GenSettings, text: string) =>
      useStore.setState({ composer: { ...st.composer, mode: 'audio', text, attachments: [], audio: { modelRef, settings } }, ui: { ...st.ui, workspace: 'chat' } });
    set('', song(), 'pop');
    expect(checkDirect('audio').reason).toMatch(/Connect Atlas Cloud/);
    set(MUSIC, song(), 'pop');
    expect(checkDirect('audio').reason).toMatch(/needs lyrics/);
    set(MUSIC, song({}, { is_instrumental: true }), 'lofi beats');
    expect(checkDirect('audio')).toMatchObject({ ok: true, estimate: { usd: 0.15 } });
  });

  it('refuses a song without lyrics before any request [LYRICS_MISSING]', async () => {
    await install();
    const send = vi.fn();
    vi.stubGlobal('fetch', send);
    const g = createGeneration({ sessionId: 's', kind: 'audio', prompt: 'pop', modelRef: MUSIC, settings: song(), origin: 'composer' });
    await expect(runGeneration(g.id)).rejects.toThrow(/\[LYRICS_MISSING\]/);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('audio in agent plans and node graphs', () => {
  async function ctx(): Promise<PlanContext> {
    const { models, schemas } = await catalog();
    return {
      workspace: 'node',
      getModel: async (r) => (models[r] ? { model: models[r], schema: schemas[r] } : null),
      defaultModel: (kind) => (kind === 'audio' ? MUSIC : null),
      defaultSettings: () => ({}),
      asset: () => undefined,
      layer: () => undefined,
    };
  }

  it('chains a lyrics step into a music step', async () => {
    const { plan, errors } = await normalizePlan(
      {
        title: 't',
        steps: [
          { id: 's1', kind: 'audio', model: LYRICS, prompt: 'a seaside promise', params: { mode: 'write_full_song' } },
          { id: 's2', kind: 'audio', prompt: 'dreamy synth-pop, female vocal', lyrics_from: 's1' },
        ],
      },
      await ctx(),
      'p',
    );
    expect(errors).toEqual([]);
    expect(plan!.steps[0]).toMatchObject({ kind: 'audio', modelRef: LYRICS, textOutput: true });
    expect(plan!.steps[1]).toMatchObject({ kind: 'audio', modelRef: MUSIC, lyricsFrom: 's1' });
    const graph = planToGraph(plan!);
    const lyricsNode = graph.nodes.find((n) => n.id === 'p_s1')!;
    expect(outputPort(lyricsNode.data, {})).toBe('text');
    expect(graph.edges).toContainEqual(expect.objectContaining({ source: 'p_s1', target: 'p_s2', targetHandle: 'lyrics' }));
  });

  it('rejects songs the model would refuse and lyrics from media steps', async () => {
    const c = await ctx();
    const noLyrics = await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'audio', prompt: 'pop' }] }, c, 'p');
    expect(noLyrics.errors.join(' ')).toMatch(/LYRICS_MISSING/);
    const own = await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'audio', prompt: 'pop', params: { lyrics: '[Verse]\nmy line', is_instrumental: false } }] }, c, 'p');
    expect(own.errors).toEqual([]);
    expect(own.plan!.steps[0]).toMatchObject({ settings: { extras: { lyrics: '[Verse]\nmy line' } } });
    const wrong = await normalizePlan(
      { title: 't', steps: [{ id: 's1', kind: 'audio', prompt: 'lofi', params: { is_instrumental: true } }, { id: 's2', kind: 'audio', prompt: 'x', lyrics_from: 's1' }] },
      c,
      'p',
    );
    expect(wrong.errors.join(' ')).toMatch(/lyrics_from must reference a text step/);
  });

  it('runs lyrics then music, sending only the song text as lyrics', async () => {
    await install();
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/model/generateAudio')) {
        const b = JSON.parse(String(init?.body));
        bodies.push(b);
        return new Response(JSON.stringify({ data: { id: b.model === 'minimax/lyrics-generation' ? 'l1' : 'm1' } }));
      }
      if (url.endsWith('/prediction/l1')) return new Response(JSON.stringify({ data: { status: 'completed', lyrics_result: { song_title: 'Tide', style_tags: ['Pop'], lyrics: '[Chorus]\nstay' } } }));
      if (url.endsWith('/prediction/m1')) return new Response(JSON.stringify({ data: { status: 'completed', outputs: ['https://cdn.test/s.mp3'] } }));
      if (url === 'https://cdn.test/s.mp3') return new Response(new Uint8Array(4), { headers: { 'content-type': 'audio/mpeg' } });
      throw new Error(`unexpected ${url}`);
    });
    const res = await executeSteps(
      [
        { id: 's1', kind: 'audio', title: 'Lyrics', prompt: 'a promise', modelRef: LYRICS, settings: song(), textOutput: true },
        { id: 's2', kind: 'audio', title: 'Song', prompt: 'synth-pop', lyricsFrom: 's1', modelRef: MUSIC, settings: song() },
      ],
      { sessionId: 's', workspace: 'node', origin: 'node', onState: () => undefined },
    );
    expect(res.failed).toEqual([]);
    expect(bodies[1]).toMatchObject({ model: 'minimax/music-3.0', lyrics: '[Chorus]\nstay' });
    expect(res.outputs.get('s2')?.assetIds).toHaveLength(1);
  });

  it('reads a finished lyrics node into the Lyrics port without running it again', () => {
    const graph: Graph = {
      nodes: [
        { id: 'ly', position: { x: 0, y: 0 }, data: { kind: 'audio', title: 'Lyrics', prompt: 'x', modelRef: LYRICS, settings: song(), generationId: 'gl', outputIndex: 0, textOutput: true } },
        { id: 'mu', position: { x: 0, y: 0 }, data: { kind: 'audio', title: 'Song', prompt: 'pop', modelRef: MUSIC, settings: song(), outputIndex: 0 } },
      ],
      edges: [{ id: 'e', source: 'ly', target: 'mu', sourceHandle: 'out', targetHandle: 'lyrics' }],
    } as Graph;
    const gens = { gl: { id: 'gl', kind: 'text', status: 'done', text: '# T\n\n[Verse]\nhi', assetIds: [] } as unknown as Generation };
    const run = graphToSteps(graph, ['mu'], gens);
    expect(run.errors).toEqual([]);
    expect(run.runIds).toEqual(['mu']);
    expect(run.steps).toContainEqual(expect.objectContaining({ id: 'ly', kind: 'text', text: '# T\n\n[Verse]\nhi' }));
    expect(run.steps.find((s) => s.id === 'mu')).toMatchObject({ kind: 'audio', lyricsFrom: 'ly' });
  });
});
