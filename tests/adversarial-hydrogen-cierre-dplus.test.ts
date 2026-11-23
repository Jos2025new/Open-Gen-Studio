// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import '../src/engine/commands';
import { createSession, useStore } from '../src/store/store';
import { useAlerts } from '../src/engine/alerts';
import { saveAssetEdit } from '../src/engine/assetRevisions';
import { decideCommandApproval, runCommandsTool } from '../src/engine/agent/commandCalls';
import { approvePlan, resumePlan } from '../src/engine/agent/planRun';
import { withOncePass } from '../src/engine/budget';
import { setApprover } from '../src/engine/commands';
import { COMMAND_REVIEW_CHANGED } from '../src/engine/commands/types';
import { createGeneration, runGeneration } from '../src/engine/jobs';
import { resetSendLocks } from '../src/engine/money/paidSend';
import { storeTickets } from '../src/engine/money/storeBridge';
import { resetActions } from '../src/engine/nodecore/action';
import type {
  CommandApprovalFeedItem,
  GenNodeData,
  ModelSummary,
  PlanFeedItem,
  ToolNodeData,
} from '../src/engine/types';
import { createFakeProvider, jsonResponse, PNG_B64, type FakeProvider } from './helpers/fakeProvider';

const blobs = vi.hoisted(() => new Map<string, Blob>());

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => null, set: async () => ({ ok: true }), del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  getAssetBlob: async (id: string) => blobs.get(id) ?? new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
  putAssetBlob: async (id: string, blob: Blob) => { blobs.set(id, blob); },
  deleteAssetBlobs: async (ids: string[]) => { for (const id of ids) blobs.delete(id); },
}));

vi.mock('../src/lib/media', async (original) => ({
  ...(await original<typeof import('../src/lib/media')>()),
  probeMedia: async () => ({ width: 64, height: 64, size: 3, duration: 5 }),
  prepareImageForUpload: async (b: Blob) => b,
  blobToDataUrl: async (b: Blob) => `data:image/png;base64,${btoa(String.fromCharCode(...new Uint8Array(await b.arrayBuffer())))}`,
  jpegThumbnail: async () => undefined,
}));

const paidRef = 'nanogpt::paid-img';
const paidMultiRef = 'nanogpt::multi-img';
const atlasSameRef = 'atlas::paid-img';
const atlasMultiSameRef = 'atlas::multi-img';
const nanoInpaintRef = 'nanogpt::inpaint-img';
const atlasInpaintRef = 'atlas::inpaint-img';
const atlasLbVidRef = 'atlas::lb-vid';
const txtOnlyRef = 'nanogpt::txt-only';
const txtOnlyEditRef = 'nanogpt::txt-only-edit';

let sid: string;
let fake: FakeProvider;

function installModels(defaultImageCost = 0.1) {
  fake = createFakeProvider({ defaultImageCost });
  fake.install();

  const fresh = createSession('D+ Hydrogen cierre check');
  sid = fresh.id;

  const paidModel = {
    ref: paidRef, provider: 'nanogpt', id: 'paid-img', name: 'Paid image', kind: 'image',
    acceptsText: true, acceptsImage: true, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] },
  } as unknown as ModelSummary;
  const paidMultiModel = {
    ref: paidMultiRef, provider: 'nanogpt', id: 'multi-img', name: 'Multi image', kind: 'image',
    acceptsText: true, acceptsImage: true, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] },
  } as unknown as ModelSummary;
  const atlasSameModel = {
    ref: atlasSameRef, provider: 'atlas', id: 'paid-img', name: 'Paid image', kind: 'image',
    acceptsText: true, acceptsImage: true, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] },
  } as unknown as ModelSummary;
  const atlasMultiSameModel = {
    ref: atlasMultiSameRef, provider: 'atlas', id: 'multi-img', name: 'Multi image', kind: 'image',
    acceptsText: true, acceptsImage: true, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] },
  } as unknown as ModelSummary;
  const nanoInpaintModel = {
    ref: nanoInpaintRef, provider: 'nanogpt', id: 'inpaint-img', name: 'Nano inpaint', kind: 'image',
    acceptsText: true, acceptsImage: true, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] },
  } as unknown as ModelSummary;
  const atlasInpaintModel = {
    ref: atlasInpaintRef, provider: 'atlas', id: 'inpaint-img', name: 'Atlas inpaint', kind: 'image',
    acceptsText: true, acceptsImage: true, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] },
  } as unknown as ModelSummary;
  const atlasLbVidModel = {
    ref: atlasLbVidRef, provider: 'atlas', id: 'lb-vid', name: 'Atlas LB Video', kind: 'video',
    acceptsText: true, acceptsImage: false, tags: [],
    price: { skus: [{ unit: 'second', usd: 0.02 }], approximate: true, lowerBound: true },
  } as unknown as ModelSummary;
  const txtOnlyModel = {
    ref: txtOnlyRef, provider: 'nanogpt', id: 'txt-only', name: 'Txt Only', kind: 'image',
    acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] },
  } as unknown as ModelSummary;
  const txtOnlyEditModel = {
    ref: txtOnlyEditRef, provider: 'nanogpt', id: 'txt-only-edit', name: 'Txt Only', kind: 'image',
    acceptsText: true, acceptsImage: true, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] },
  } as unknown as ModelSummary;

  const paidSchema = {
    ref: paidRef,
    params: [{ key: 'n', label: 'Count', role: 'count' as const, type: 'integer' as const, min: 1, max: 1, default: 1 }],
    source: 'catalog' as const,
    slots: { prompt: 'prompt', promptRequired: true, images: { key: 'imageDataUrls', min: 0, max: 4, multiple: true, format: 'data-url' as const } },
  };

  useStore.setState((state) => ({
    activeSessionId: sid,
    sessions: { [sid]: fresh },
    generations: {}, tickets: {}, spendLog: [], spentUsd: 0, quotes: {}, assets: {}, library: [],
    catalog: {
      ...state.catalog,
      models: {
        [paidRef]: paidModel,
        [paidMultiRef]: paidMultiModel,
        [atlasSameRef]: atlasSameModel,
        [atlasMultiSameRef]: atlasMultiSameModel,
        [nanoInpaintRef]: nanoInpaintModel,
        [atlasInpaintRef]: atlasInpaintModel,
        [atlasLbVidRef]: atlasLbVidModel,
        [txtOnlyRef]: txtOnlyModel,
        [txtOnlyEditRef]: txtOnlyEditModel,
      },
      schemas: {
        [paidRef]: paidSchema,
        [paidMultiRef]: { ...paidSchema, ref: paidMultiRef },
        [atlasSameRef]: { ...paidSchema, ref: atlasSameRef, slots: { prompt: 'prompt', promptRequired: true, images: { key: 'images', min: 0, max: 4, multiple: true, format: 'url' } } },
        [atlasMultiSameRef]: {
          ref: atlasMultiSameRef,
          params: [{ key: 'n', label: 'Count', role: 'count', type: 'integer', min: 1, max: 4, default: 1 }],
          source: 'catalog',
          slots: { prompt: 'prompt', promptRequired: true, images: { key: 'images', min: 0, max: 4, multiple: true, format: 'url' } },
        },
        [nanoInpaintRef]: {
          ref: nanoInpaintRef, params: [], source: 'catalog',
          slots: { prompt: 'prompt', promptRequired: true, images: { key: 'imageDataUrls', min: 0, max: 1, multiple: false, format: 'data-url' }, mask: { key: 'maskDataUrl', required: true, convention: 'white', format: 'data-url' } },
        },
        [atlasInpaintRef]: {
          ref: atlasInpaintRef, params: [], source: 'catalog',
          slots: { prompt: 'prompt', promptRequired: true, images: { key: 'image', min: 0, max: 1, multiple: false, format: 'url' }, mask: { key: 'mask_image', required: true, convention: 'white', format: 'url' } },
        },
        [atlasLbVidRef]: {
          ref: atlasLbVidRef,
          params: [{ key: 'duration', label: 'Duration', role: 'duration', type: 'enum', options: [5, 10], default: 5 }],
          source: 'catalog',
          slots: { prompt: 'prompt', promptRequired: true },
        },
        [txtOnlyRef]: { ref: txtOnlyRef, params: [], source: 'catalog', slots: { prompt: 'prompt', promptRequired: true } },
        [txtOnlyEditRef]: { ...paidSchema, ref: txtOnlyEditRef },
      },
    },
    settings: {
      ...state.settings,
      keys: { ...state.settings.keys, nanogpt: 'test-only', atlas: 'test-only', fal: 'test-only', openrouter: 'test-only' },
      ops: { ...state.settings.ops, edit: paidRef, editRegion: nanoInpaintRef },
      budgetOn: true, budgetUsd: 1, budgetNoAsk: false, budgetAccepted: null,
      autoSwitchProvider: 'ask',
    },
  }));
}

beforeEach(() => {
  blobs.clear();
  resetSendLocks();
  resetActions();
  useAlerts.setState({ alerts: [] });
  setApprover(null);
  installModels(0.1);
});

afterEach(() => {
  blobs.clear();
  useAlerts.setState({ alerts: [] });
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('control: dynamic downstream edit_region bound after upstream then hitting 402 still blocks if static mask is edited before Yes this time', async () => {
  blobs.set('ast_mask', new Blob([new Uint8Array([5, 5, 5, 5])], { type: 'image/png' }));
  fake.onNext('downstream 402 mask', 'http-402');

  const upData: GenNodeData = {
    kind: 'image', title: 'Upstream', prompt: 'upstream step ok', modelRef: paidRef,
    settings: { count: 1, advanced: {} }, outputIndex: 0,
  };
  const downData: ToolNodeData = {
    kind: 'tool', title: 'Downstream Inpaint', op: 'edit_region',
    params: { mask: 'ast_mask', instruction: 'downstream 402 mask' }, outputIndex: 0,
  };
  useStore.setState((state) => ({
    assets: {
      ...state.assets,
      ast_mask: { id: 'ast_mask', kind: 'image', mime: 'image/png', width: 64, height: 64, sessionId: sid, origin: 'mask', stored: true, favorite: false, createdAt: 1 },
    },
    sessions: {
      ...state.sessions,
      [sid]: {
        ...state.sessions[sid],
        graph: {
          nodes: [
            { id: 'n_up', position: { x: 0, y: 0 }, data: upData },
            { id: 'n_down', position: { x: 200, y: 0 }, data: downData },
          ],
          edges: [{ id: 'e_in', source: 'n_up', target: 'n_down', sourceHandle: 'out', targetHandle: 'input' }],
        },
      },
    },
  }));

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n_down'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));

  expect(decideCommandApproval(sid, commandCard().id, 'approve')).toBe(true);
  await pending;

  const alert = useAlerts.getState().alerts.find((a) => a.actions?.some((act) => act.label === 'Yes, this time'));
  expect(alert).toBeDefined();

  // Edit static mask after downstream node bound its dynamic fingerprint and hit 402:
  expect(await saveAssetEdit('ast_mask', new Blob([new Uint8Array([8, 8, 8, 8])], { type: 'image/png' }), 'original')).not.toBeNull();
  alert!.actions!.find((act) => act.label === 'Yes, this time')!.run();

  await vi.waitFor(() => {
    const downGen = Object.values(useStore.getState().generations).find((g) => g.stepId === 'n_down');
    expect(downGen?.error).toBe(COMMAND_REVIEW_CHANGED);
  }, { timeout: 3000 });
  expect(fake.acceptedCount('downstream 402 mask')).toBe(0);
});

it('control: dynamic downstream node with text-only model resolved to edit twin freezes static ref and blocks on edit', async () => {
  blobs.set('ast_ref', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }));
  const holdUp = fake.holdNext('upstream txt twin');

  const upData: GenNodeData = {
    kind: 'image', title: 'Upstream', prompt: 'upstream txt twin', modelRef: paidRef,
    settings: { count: 1, advanced: {} }, outputIndex: 0,
  };
  const downData: GenNodeData = {
    kind: 'image', title: 'Downstream Twin', prompt: 'downstream txt twin', modelRef: txtOnlyRef,
    settings: { count: 1, advanced: {} }, outputIndex: 0,
  };
  useStore.setState((state) => ({
    assets: {
      ...state.assets,
      ast_ref: { id: 'ast_ref', kind: 'image', mime: 'image/png', width: 64, height: 64, sessionId: sid, origin: 'upload', stored: true, favorite: false, createdAt: 1 },
    },
    sessions: {
      ...state.sessions,
      [sid]: {
        ...state.sessions[sid],
        graph: {
          nodes: [
            { id: 'n_up', position: { x: 0, y: 0 }, data: upData },
            { id: 'n_ref', position: { x: 0, y: 200 }, data: { kind: 'asset', title: 'Ref', assetId: 'ast_ref' } },
            { id: 'n_down', position: { x: 200, y: 0 }, data: downData },
          ],
          edges: [
            { id: 'e_up', source: 'n_up', target: 'n_down', sourceHandle: 'out', targetHandle: 'ref' },
            { id: 'e_ref', source: 'n_ref', target: 'n_down', sourceHandle: 'out', targetHandle: 'ref' },
          ],
        },
      },
    },
  }));

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n_down'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));

  expect(decideCommandApproval(sid, commandCard().id, 'approve')).toBe(true);
  await holdUp.arrived;

  expect(await saveAssetEdit('ast_ref', new Blob([new Uint8Array([9, 9, 9, 9])], { type: 'image/png' }), 'original')).not.toBeNull();
  holdUp.resolve();
  await pending;

  expect(fake.acceptedCount('downstream txt twin')).toBe(0);
});

it('control: 402 provider switch in autoSwitchProvider=always mode blocks if approved asset was edited in-place', async () => {
  blobs.set('ast_ref', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }));
  fake.onNext('402 always edit', 'http-402');

  useStore.setState((state) => ({
    settings: { ...state.settings, autoSwitchProvider: 'always' },
    assets: {
      ...state.assets,
      ast_ref: { id: 'ast_ref', kind: 'image', mime: 'image/png', width: 64, height: 64, sessionId: sid, origin: 'upload', stored: true, favorite: false, createdAt: 1 },
    },
    sessions: {
      ...state.sessions,
      [sid]: {
        ...state.sessions[sid],
        graph: {
          nodes: [
            { id: 'n_ref', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Ref', assetId: 'ast_ref' } },
            { id: 'n_img', position: { x: 200, y: 0 }, data: { kind: 'image', title: 'Img', prompt: '402 always edit', modelRef: paidRef, settings: { count: 1, advanced: {} }, outputIndex: 0 } },
          ],
          edges: [{ id: 'e_ref', source: 'n_ref', target: 'n_img', sourceHandle: 'out', targetHandle: 'ref' }],
        },
      },
    },
  }));

  // Hook the schema ensure / 402 moment by editing ast_ref when the first 402 fetch arrives:
  const origFetch = globalThis.fetch;
  let edited = false;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await origFetch(input, init);
    if (res.status === 402 && !edited) {
      edited = true;
      await saveAssetEdit('ast_ref', new Blob([new Uint8Array([9, 9, 9, 9])], { type: 'image/png' }), 'original');
    }
    return res;
  }));

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n_img'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));

  expect(decideCommandApproval(sid, commandCard().id, 'approve')).toBe(true);
  await pending;

  expect(edited).toBe(true);
  expect(fake.acceptedCount('402 always edit')).toBe(0);
});

it('control: resumePlan(retry) with Continue once pass when over remaining budget completes and re-closes ticket', async () => {
  useStore.setState((state) => ({
    settings: { ...state.settings, budgetOn: true, budgetUsd: 0.05 },
  }));

  fake.onNext('plan s1', async () => jsonResponse({ data: [{ b64_json: PNG_B64 }], cost: 0.02 }, 200));
  fake.onNext('plan s2', async () => jsonResponse({ error: { message: 'Temporary bad request' } }, 400));

  const planItem: PlanFeedItem = {
    id: 'plan-resume-once', createdAt: 1, type: 'plan', style: 'auto', workspace: 'chat', status: 'awaiting',
    plan: {
      id: 'pln-resume-once', title: 'Resume Once', summary: '', workspace: 'chat', style: '', subjects: [], adjustments: [],
      steps: [
        { id: 's1', kind: 'image', title: 'Step 1', prompt: 'plan s1', modelRef: paidRef, settings: { count: 1, advanced: {} }, refs: [] },
        { id: 's2', kind: 'image', title: 'Step 2', prompt: 'plan s2', modelRef: paidRef, settings: { count: 1, advanced: {} }, refs: [] },
      ],
    },
    stepStates: {}, stepGenerations: {}, estimate: { usd: 0.2, approximate: false },
  };
  useStore.setState((state) => ({
    sessions: { ...state.sessions, [sid]: { ...state.sessions[sid], feed: [planItem] } },
  }));

  await withOncePass(sid, (pass) => approvePlan(sid, planItem.id, pass), 0.2, false);
  expect(storeTickets.get(`plan:${planItem.id}`)?.closed).toBe(true);

  await withOncePass(sid, (pass) => resumePlan(sid, planItem.id, 'retry', true, pass), 0.1, false);
  const after = useStore.getState().sessions[sid].feed.find((f): f is PlanFeedItem => f.id === planItem.id);
  expect(after?.status).toBe('done');
  expect(storeTickets.get(`plan:${planItem.id}`)?.closed).toBe(true);
  expect(storeTickets.get(`plan:${planItem.id}`)?.pass?.steps).toEqual({});
});

it('control: standalone lowerBound generation with Continue once blocks second chunk when live quote exceeds remaining budget', async () => {
  installModels(0.3);
  useStore.setState((state) => ({
    settings: { ...state.settings, budgetOn: true, budgetUsd: 0.5 },
  }));

  const g = withOncePass(sid, (pass) => createGeneration({
    sessionId: sid, kind: 'video', modelRef: atlasLbVidRef, prompt: 'atlas lb two chunks',
    settings: { count: 2, duration: 5, advanced: {} }, origin: 'composer',
    estimate: { usd: 0.1, approximate: true, lowerBound: true }, budgetPass: pass,
  }), 0.1, true);

  await expect(runGeneration(g.id)).rejects.toThrow();
  expect(fake.acceptedCount('atlas lb two chunks')).toBe(1);
  expect(useStore.getState().spentUsd).toBeCloseTo(0.3, 5);
});

it('control: cb70f0f3 sendMediaViaPaidGate re-checks approvedFingerprint before Atlas retry transport', async () => {
  vi.useFakeTimers();
  blobs.set('ast_ref', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }));
  fake.onNext('atlas retry fp check', 'atlas-upstream-denied');

  useStore.setState((state) => ({
    assets: {
      ...state.assets,
      ast_ref: { id: 'ast_ref', kind: 'image', mime: 'image/png', width: 64, height: 64, sessionId: sid, origin: 'upload', stored: true, favorite: false, createdAt: 1 },
    },
    sessions: {
      ...state.sessions,
      [sid]: {
        ...state.sessions[sid],
        graph: {
          nodes: [
            { id: 'n_ref', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Ref', assetId: 'ast_ref' } },
            { id: 'n_atlas', position: { x: 200, y: 0 }, data: { kind: 'image', title: 'Atlas', prompt: 'atlas retry fp check', modelRef: atlasSameRef, settings: { count: 1, advanced: {} }, outputIndex: 0 } },
          ],
          edges: [{ id: 'e_ref', source: 'n_ref', target: 'n_atlas', sourceHandle: 'out', targetHandle: 'ref' }],
        },
      },
    },
  }));

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n_atlas'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));
  expect(decideCommandApproval(sid, commandCard().id, 'approve')).toBe(true);

  await vi.waitFor(() => expect(fake.attemptCount('atlas retry fp check')).toBe(1));
  expect(await saveAssetEdit('ast_ref', new Blob([new Uint8Array([9, 9, 9, 9])], { type: 'image/png' }), 'original')).not.toBeNull();

  await vi.advanceTimersByTimeAsync(10_000);
  await pending;

  expect(fake.acceptedCount('atlas retry fp check')).toBe(0);
  const g = Object.values(useStore.getState().generations)[0];
  expect(g?.error).toBe(COMMAND_REVIEW_CHANGED);
});

it('control: dynamic downstream op step keeps approved model even when upstream switches provider on 402', async () => {
  const atlasEditRef = 'atlas::paid-img-edit';
  useStore.setState((state) => ({
    settings: { ...state.settings, autoSwitchProvider: 'always', budgetOn: true, budgetUsd: 1 },
    catalog: {
      ...state.catalog,
      models: {
        ...state.catalog.models,
        [atlasEditRef]: {
          ref: atlasEditRef, provider: 'atlas', id: 'paid-img-edit', name: 'Paid image edit', kind: 'image',
          acceptsText: true, acceptsImage: true, tags: [], price: { skus: [{ unit: 'output', usd: 0.5 }] },
        } as unknown as ModelSummary,
      },
      schemas: {
        ...state.catalog.schemas,
        [atlasEditRef]: {
          ref: atlasEditRef, params: [], source: 'catalog',
          slots: { prompt: 'prompt', promptRequired: true, images: { key: 'images', min: 0, max: 4, multiple: true, format: 'url' } },
        },
      },
    },
    sessions: {
      ...state.sessions,
      [sid]: {
        ...state.sessions[sid],
        graph: {
          nodes: [
            { id: 'n_up', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'Up', prompt: 'up 402 op', modelRef: paidRef, settings: { count: 1, advanced: {} }, outputIndex: 0 } },
            { id: 'n_down', position: { x: 200, y: 0 }, data: { kind: 'tool', title: 'Down Edit', op: 'edit', params: { instruction: 'down after 402' }, outputIndex: 0 } },
          ],
          edges: [{ id: 'e_in', source: 'n_up', target: 'n_down', sourceHandle: 'out', targetHandle: 'input' }],
        },
      },
    },
  }));
  fake.onNext('up 402 op', 'http-402');

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n_down'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));
  expect(commandCard().estimate?.usd).toBeCloseTo(0.2, 5);
  expect(decideCommandApproval(sid, commandCard().id, 'approve')).toBe(true);
  await pending;

  const gens = Object.values(useStore.getState().generations);
  expect(gens.map((g) => ({ step: g.stepId, status: g.status, model: g.modelRef }))).toEqual([
    { step: 'n_up', status: 'done', model: atlasSameRef },
    { step: 'n_down', status: 'done', model: paidRef },
  ]);
});
