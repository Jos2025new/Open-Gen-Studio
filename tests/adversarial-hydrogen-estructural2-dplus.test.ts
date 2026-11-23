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
const atlasSameRef = 'atlas::paid-img';
const atlasInpaintRef = 'atlas::inpaint-img';
const atlasLbVidRef = 'atlas::lb-vid';

let sid: string;
let sid2: string;
let fake: FakeProvider;

function installModels(defaultImageCost = 0.1) {
  fake = createFakeProvider({ defaultImageCost });
  fake.install();

  const fresh = createSession('D+ Hydrogen structural reattack 2');
  const other = createSession('D+ Hydrogen other session 2');
  sid = fresh.id;
  sid2 = other.id;

  const paidModel = {
    ref: paidRef, provider: 'nanogpt', id: 'paid-img', name: 'Paid image', kind: 'image',
    acceptsText: true, acceptsImage: true, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] },
  } as unknown as ModelSummary;
  const atlasSameModel = {
    ref: atlasSameRef, provider: 'atlas', id: 'paid-img', name: 'Paid image', kind: 'image',
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

  const paidSchema = {
    ref: paidRef,
    params: [{ key: 'n', label: 'Count', role: 'count' as const, type: 'integer' as const, min: 1, max: 1, default: 1 }],
    source: 'catalog' as const,
    slots: { prompt: 'prompt', promptRequired: true, images: { key: 'imageDataUrls', min: 0, max: 4, multiple: true, format: 'data-url' as const } },
  };

  useStore.setState((state) => ({
    activeSessionId: sid,
    sessions: {
      [sid]: {
        ...fresh,
        graph: {
          nodes: [
            { id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'Node 1', prompt: 'node one prompt', modelRef: paidRef, settings: { count: 1, advanced: {} }, outputIndex: 0 } },
          ],
          edges: [],
        },
      },
      [sid2]: other,
    },
    generations: {}, tickets: {}, spendLog: [], spentUsd: 0, quotes: {}, assets: {}, library: [],
    catalog: {
      ...state.catalog,
      models: {
        [paidRef]: paidModel,
        [atlasSameRef]: atlasSameModel,
        [atlasInpaintRef]: atlasInpaintModel,
        [atlasLbVidRef]: atlasLbVidModel,
      },
      schemas: {
        [paidRef]: paidSchema,
        [atlasSameRef]: { ...paidSchema, ref: atlasSameRef, slots: { prompt: 'prompt', promptRequired: true, images: { key: 'images', min: 0, max: 4, multiple: true, format: 'url' } } },
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
      },
    },
    settings: {
      ...state.settings,
      keys: { ...state.settings.keys, nanogpt: 'test-only', atlas: 'test-only', fal: 'test-only', openrouter: 'test-only' },
      ops: { ...state.settings.ops, edit: paidRef, editRegion: atlasInpaintRef },
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// reproduce: 402 provider switch (credit.ts:231) clears approvedFingerprint: undefined instead of preserving/re-checking it on the substitute send.
it.fails('H3a: 402 provider switch clears approvedFingerprint and sends edited asset bytes without re-review', async () => {
  blobs.set('ast_ref', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }));
  fake.onNext('402 fp bypass', 'http-402');

  const imgData: GenNodeData = {
    kind: 'image', title: 'Img', prompt: '402 fp bypass', modelRef: paidRef,
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
            { id: 'n_ref', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Ref', assetId: 'ast_ref' } },
            { id: 'n_img', position: { x: 200, y: 0 }, data: imgData },
          ],
          edges: [{ id: 'e_ref', source: 'n_ref', target: 'n_img', sourceHandle: 'out', targetHandle: 'ref' }],
        },
      },
    },
  }));

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n_img'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));

  expect(decideCommandApproval(sid, commandCard().id, 'approve')).toBe(true);
  await pending;

  const alert = useAlerts.getState().alerts.find((a) => a.actions?.some((act) => act.label === 'Yes, this time'));
  expect(alert).toBeDefined();

  // Edit the approved reference asset in-place before accepting the 402 provider switch:
  expect(await saveAssetEdit('ast_ref', new Blob([new Uint8Array([9, 9, 9, 9])], { type: 'image/png' }), 'original')).not.toBeNull();

  alert!.actions!.find((act) => act.label === 'Yes, this time')!.run();
  await vi.waitFor(() => {
    const g = Object.values(useStore.getState().generations)[0];
    expect(g && (g.status === 'done' || g.error === COMMAND_REVIEW_CHANGED)).toBe(true);
  }, { timeout: 3000 });

  expect(fake.acceptedCount('402 fp bypass'), '402 substitute sent edited asset bytes without fingerprint verification').toBe(0);
});

// reproduce: previewRun (flow/actions.ts:272) skips stepFingerprints when dynamic=true, leaving static inputs (params.mask) on downstream nodes unprotected against in-place edits.
it.fails('H3b: downstream node with dynamic upstream drops approvedFingerprint on its static mask asset', async () => {
  blobs.set('ast_mask', new Blob([new Uint8Array([5, 5, 5, 5])], { type: 'image/png' }));
  const holdUp = fake.holdNext('upstream image step');

  const upData: GenNodeData = {
    kind: 'image', title: 'Upstream', prompt: 'upstream image step', modelRef: paidRef,
    settings: { count: 1, advanced: {} }, outputIndex: 0,
  };
  const downData: ToolNodeData = {
    kind: 'tool', title: 'Downstream Inpaint', op: 'edit_region',
    params: { mask: 'ast_mask', instruction: 'downstream masked edit' }, outputIndex: 0,
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
  await holdUp.arrived;

  // Edit the static mask asset in-place while upstream node is running:
  expect(await saveAssetEdit('ast_mask', new Blob([new Uint8Array([8, 8, 8, 8])], { type: 'image/png' }), 'original')).not.toBeNull();
  holdUp.resolve();
  await pending;

  expect(fake.acceptedCount('downstream masked edit'), 'downstream step with dynamic upstream sent edited mask bytes without fingerprint check').toBe(0);
});

// reproduce: resumePlan (planRun.ts:368) clears ticket.closed without clearing ticket.pass (whose pass.steps was emptied to {} on close), causing paidSend to reject with PASS_EXCEEDED even when within remaining budget.
it.fails('H4a: resumePlan(retry) within budget after an initial Continue once plan stays deadlocked by stale pass header', async () => {
  useStore.setState((state) => ({
    settings: { ...state.settings, budgetOn: true, budgetUsd: 0.15 },
  }));

  fake.onNext('plan step one cheap', async () => jsonResponse({ data: [{ b64_json: PNG_B64 }], cost: 0.02 }, 200));
  fake.onNext('plan step two retry', async () => jsonResponse({ error: { message: 'Temporary bad request' } }, 400));

  const planItem: PlanFeedItem = {
    id: 'plan-resume-deadlock', createdAt: 1, type: 'plan', style: 'auto', workspace: 'chat', status: 'awaiting',
    plan: {
      id: 'pln-resume-deadlock', title: 'Resume Deadlock', summary: '', workspace: 'chat', style: '', subjects: [], adjustments: [],
      steps: [
        { id: 's1', kind: 'image', title: 'Step 1', prompt: 'plan step one cheap', modelRef: paidRef, settings: { count: 1, advanced: {} }, refs: [] },
        { id: 's2', kind: 'image', title: 'Step 2', prompt: 'plan step two retry', modelRef: paidRef, settings: { count: 1, advanced: {} }, refs: [] },
      ],
    },
    stepStates: {}, stepGenerations: {}, estimate: { usd: 0.2, approximate: false },
  };
  useStore.setState((state) => ({
    sessions: { ...state.sessions, [sid]: { ...state.sessions[sid], feed: [planItem] } },
  }));

  await withOncePass(sid, (pass) => approvePlan(sid, planItem.id, pass), 0.2, false);
  expect(useStore.getState().spentUsd).toBeCloseTo(0.02, 5);
  expect(storeTickets.get(`plan:${planItem.id}`)?.closed).toBe(true);
  expect(fake.acceptedCount('plan step two retry')).toBe(1);

  // Remaining budget is $0.13 >= $0.10, so Retry runs without a new Continue once pass:
  await resumePlan(sid, planItem.id, 'retry', true);

  const after = useStore.getState().sessions[sid].feed.find((f): f is PlanFeedItem => f.id === planItem.id);
  expect(after?.status).toBe('done');
  expect(fake.acceptedCount('plan step two retry'), 'resumePlan left stale once pass with empty steps on ticket and deadlocked within-budget retry').toBe(2);
});

// reproduce: ticketPassFromEstimate (storeBridge.ts:140) sets maxUsd = price.usd for lowerBound standalone gen tickets, blocking real quotes above the minimum even within budget.
it.fails('H4b: Continue once on standalone lowerBound generation blocks when live quote exceeds minimum price even within budget', async () => {
  installModels(0.25);
  useStore.setState((state) => ({
    settings: { ...state.settings, budgetOn: true, budgetUsd: 0.5 },
  }));

  const g = withOncePass(sid, (pass) => createGeneration({
    sessionId: sid, kind: 'video', modelRef: atlasLbVidRef, prompt: 'atlas lowerbound video',
    settings: { count: 1, duration: 5, advanced: {} }, origin: 'composer',
    estimate: { usd: 0.1, approximate: true, lowerBound: true }, budgetPass: pass,
  }), 0.1, true);

  await runGeneration(g.id);

  expect(fake.acceptedCount('atlas lowerbound video'), 'Continue once on lowerBound generation capped maxUsd at minimum $0.10 and deadlocked at quote $0.25').toBe(1);
  expect(useStore.getState().generations[g.id]?.status).toBe('done');
});
