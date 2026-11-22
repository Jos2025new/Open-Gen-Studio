// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const disk = vi.hoisted(() => ({ raw: undefined as string | undefined }));
const lock = vi.hoisted(() => ({ held: true }));

vi.mock('../src/lib/writerLock', async (orig) => ({ ...(await orig<typeof import('../src/lib/writerLock')>()), holdsWriterLock: () => lock.held, mayStartWork: () => lock.held }));
vi.mock('../src/lib/idb', async () => {
  const { guard } = await import('../src/lib/saveGuard');
  return {
    stateDb: {
      get: async () => disk.raw,
      set: async (_k: string, raw: string | { text(): string }) => {
        if (guard.discarding) return 'fail';
        if (!lock.held) return 'browser-only';
        disk.raw = typeof raw === 'string' ? raw : raw.text();
        return 'ok';
      },
      del: async () => undefined,
    },
    cacheDb: { get: async () => undefined, set: async () => undefined },
    getAssetBlob: async () => new Blob(['img'], { type: 'image/png' }),
    putAssetBlob: async () => undefined,
    deleteAssetBlobs: async () => undefined,
  };
});
vi.mock('../src/lib/media', async (orig) => ({ ...(await orig<typeof import('../src/lib/media')>()), probeMedia: async () => ({ width: 512, height: 512 }) }));
vi.mock('../src/engine/design/raster', () => ({ flushRaster: async () => undefined }));

import { guard } from '../src/lib/saveGuard';
import { HttpError } from '../src/lib/http';
import { useStore } from '../src/store/store';
import { generateDirect, regenerate } from '../src/engine/actions';
import { forgetBalances } from '../src/engine/credit';
import { deleteNodes, runNodes } from '../src/engine/flow/actions';
import { lockedNodes, writingNodes } from '../src/engine/flow/locks';
import { controllers, running } from '../src/engine/jobState';
import { ADAPTERS } from '../src/engine/providers/registry';
import { run } from '../src/engine/commands';
import '../src/engine/flow/commands';
import type { ModelSummary } from '../src/engine/types';
import { mainThread } from './helpers/threads';

const NANO = 'nanogpt::seed';
const sid = () => useStore.getState().activeSessionId;
const imgOut = (tag = 'x', costUsd = 0.1) => ({ outputs: [{ blob: new Blob([tag], { type: 'image/png' }), mime: 'image/png' }], costUsd });

function setupStore() {
  const st = useStore.getState();
  const sId = st.activeSessionId;
  const model: ModelSummary = {
    ref: NANO,
    provider: 'nanogpt',
    id: 'seed',
    name: 'Seed',
    kind: 'image',
    acceptsText: true,
    acceptsImage: false,
    tags: [],
    price: { skus: [{ unit: 'output', usd: 0.1 }] },
  };
  const schema = { ref: NANO, params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' as const };
  useStore.setState({
    generations: {},
    quotes: {},
    spendLog: [],
    spentUsd: 0,
    assets: {},
    ui: { ...st.ui, workspace: 'node', home: false, space: undefined, toasts: [] },
    composer: {
      ...st.composer,
      mode: 'image',
      text: 'red fox in snow',
      attachments: [],
      editing: null,
      image: { modelRef: NANO, settings: { count: 1, advanced: {} } },
    },
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k-n' }, budgetOn: false, mutedNotices: [] },
    catalog: { ...st.catalog, models: { [NANO]: model }, schemas: { [NANO]: schema } } as never,
    sessions: {
      ...st.sessions,
      [sId]: { ...st.sessions[sId], feed: [], graph: { nodes: [], edges: [] }, agents: mainThread({ history: [], notes: [], questionRound: 0, busy: false }) },
    },
  });
}

beforeEach(() => {
  disk.raw = undefined;
  lock.held = true;
  guard.discarding = false;
  running.clear();
  controllers.clear();
  forgetBalances();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { throw new Error(`Unexpected fetch: ${url}`); }));
  setupStore();
});

afterEach(() => {
  running.clear();
  controllers.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('runInNodes holds node lock during generation', () => {
  it('pressing Run (runNodes) on the created node while runInNodes is in flight does not double-send or double-charge, and releases lock when done', async () => {
    let release!: () => void;
    let entered!: () => void;
    const inFlight = new Promise<void>((r) => { entered = r; });
    let calls = 0;
    const genSpy = vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementation(async () => {
      if (++calls === 1) {
        entered();
        await new Promise<void>((r) => { release = r; });
      }
      return imgOut(`img-${calls}`, 0.1);
    });

    await generateDirect('image');
    await inFlight;

    const sId = sid();
    const genNode = useStore.getState().sessions[sId].graph.nodes.find((n) => n.data.kind === 'image');
    expect(genNode).toBeDefined();
    const nodeId = genNode!.id;
    const genId = (genNode!.data as { generationId?: string }).generationId!;

    // While runInNodes' generation is in flight, the node must be locked for writing.
    expect(lockedNodes(sId).has(nodeId)).toBe(true);
    expect(writingNodes(sId).has(nodeId)).toBe(true);

    // Concurrent Run on the created node must NOT send a second paid request.
    const concurrent = runNodes(sId, [nodeId]);
    const raceResult = await concurrent;
    expect(raceResult).toBeNull();
    expect(genSpy).toHaveBeenCalledTimes(1);

    // Finish the first generation; lock must be released cleanly.
    release();
    await running.get(genId);
    await vi.waitFor(() => expect(lockedNodes(sId).has(nodeId)).toBe(false));

    expect(genSpy).toHaveBeenCalledTimes(1);
    expect(useStore.getState().spentUsd).toBeCloseTo(0.1);
    expect(useStore.getState().spendLog).toHaveLength(1);

    // After release, a subsequent runNodes on the same node works normally.
    const afterResult = await runNodes(sId, [nodeId]);
    expect(afterResult).not.toBeNull();
    expect(genSpy).toHaveBeenCalledTimes(2);
    expect(useStore.getState().spentUsd).toBeCloseTo(0.2);
  });

  it('nodes.run.start command while runInNodes is running does not double-send or double-charge', async () => {
    let release!: () => void;
    let entered!: () => void;
    const inFlight = new Promise<void>((r) => { entered = r; });
    let calls = 0;
    const genSpy = vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementation(async () => {
      if (++calls === 1) {
        entered();
        await new Promise<void>((r) => { release = r; });
      }
      return imgOut(`img-${calls}`, 0.1);
    });

    await generateDirect('image');
    await inFlight;

    const sId = sid();
    const genNode = useStore.getState().sessions[sId].graph.nodes.find((n) => n.data.kind === 'image')!;
    const genId = (genNode.data as { generationId?: string }).generationId!;

    const cmdResult = await run({ cmd: 'nodes.run.start', args: { targets: [genNode.id] }, on: { session: sId } }, { caller: 'cli', approver: () => true });
    expect(cmdResult.ok).toBe(false);
    expect(genSpy).toHaveBeenCalledTimes(1);

    release();
    await running.get(genId);
    await vi.waitFor(() => expect(lockedNodes(sId).has(genNode.id)).toBe(false));

    expect(genSpy).toHaveBeenCalledTimes(1);
    expect(useStore.getState().spentUsd).toBeCloseTo(0.1);
    expect(useStore.getState().spendLog).toHaveLength(1);
  });

  it('releases the node lock when the runInNodes generation fails', async () => {
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockRejectedValueOnce(new HttpError(500, 'boom', {}));

    await generateDirect('image');
    const sId = sid();
    const genNode = useStore.getState().sessions[sId].graph.nodes.find((n) => n.data.kind === 'image')!;
    const genId = (genNode.data as { generationId?: string }).generationId!;

    await vi.waitFor(() => expect(useStore.getState().generations[genId]?.status).toBe('error'));
    await vi.waitFor(() => expect(lockedNodes(sId).has(genNode.id)).toBe(false));
  });

  it('concurrent regenerate and deleteNodes on the created node while runInNodes is running are blocked (no double send/charge)', async () => {
    let release!: () => void;
    let entered!: () => void;
    const inFlight = new Promise<void>((r) => { entered = r; });
    let calls = 0;
    const genSpy = vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementation(async () => {
      if (++calls === 1) {
        entered();
        await new Promise<void>((r) => { release = r; });
      }
      return imgOut(`img-${calls}`, 0.1);
    });

    await generateDirect('image');
    await inFlight;

    const sId = sid();
    const genNode = useStore.getState().sessions[sId].graph.nodes.find((n) => n.data.kind === 'image')!;
    const genId = (genNode.data as { generationId?: string }).generationId!;

    // Without holdAttemptNode, deleteNodes() deletes the node while it is generating!
    const delErr = deleteNodes(sId, [genNode.id]);
    expect(delErr).toMatch(/generating/i);
    expect(useStore.getState().sessions[sId].graph.nodes.some((n) => n.id === genNode.id)).toBe(true);

    // Without holdAttemptNode, regenerate() acquires the lock and fires a second paid request!
    await regenerate(genId);
    expect(genSpy).toHaveBeenCalledTimes(1);

    release();
    await running.get(genId);
    await vi.waitFor(() => expect(lockedNodes(sId).has(genNode.id)).toBe(false));
    expect(genSpy).toHaveBeenCalledTimes(1);
    expect(useStore.getState().spentUsd).toBeCloseTo(0.1);
    expect(useStore.getState().spendLog).toHaveLength(1);
  });

  it('runNodes during a 402 auto-switch inside runInNodes is blocked (no double send/charge)', async () => {
    const ATLAS = 'atlas::seed';
    const st = useStore.getState();
    useStore.setState({
      settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'k-a' }, autoSwitchProvider: 'always' },
      catalog: {
        ...st.catalog,
        models: {
          ...st.catalog.models,
          [ATLAS]: { ref: ATLAS, provider: 'atlas', id: 'seed', name: 'Seed', kind: 'image', acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'output', usd: 0.08 }] } },
        },
        schemas: {
          ...st.catalog.schemas,
          [ATLAS]: { ref: ATLAS, params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' },
        },
      } as never,
    });

    let releaseBalance!: () => void;
    let inBalance!: () => void;
    const waitingBalance = new Promise<void>((r) => { inBalance = r; });
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockRejectedValueOnce(new HttpError(402, 'Insufficient credits', {}));
    vi.spyOn(ADAPTERS.atlas, 'balance').mockImplementationOnce(async () => {
      inBalance();
      await new Promise<void>((r) => { releaseBalance = r; });
      return 10;
    });
    const atlasSpy = vi.spyOn(ADAPTERS.atlas, 'generate').mockResolvedValue(imgOut('atlas-1', 0.08));

    await generateDirect('image');
    await waitingBalance;

    const sId = sid();
    const genNode = useStore.getState().sessions[sId].graph.nodes.find((n) => n.data.kind === 'image')!;
    const genId = (genNode.data as { generationId?: string }).generationId!;
    // At this exact point g.status is 'error' (so previewRun's busyGen is false), only the node lock protects it!
    expect(useStore.getState().generations[genId].status).toBe('error');

    const race = await runNodes(sId, [genNode.id]);
    expect(race).toBeNull();

    releaseBalance();
    await vi.waitFor(() => expect(useStore.getState().generations[genId].status).toBe('done'));
    await vi.waitFor(() => expect(lockedNodes(sId).has(genNode.id)).toBe(false));
    expect(atlasSpy).toHaveBeenCalledTimes(1);
    expect(useStore.getState().spentUsd).toBeCloseTo(0.08);
    expect(useStore.getState().spendLog).toHaveLength(1);
  });
});
