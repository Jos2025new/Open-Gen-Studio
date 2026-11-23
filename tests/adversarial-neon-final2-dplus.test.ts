// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import '../src/engine/commands';
import { createSession, useStore } from '../src/store/store';
import { useAlerts } from '../src/engine/alerts';
import { saveAssetEdit } from '../src/engine/assetRevisions';
import { decideCommandApproval, runCommandsTool } from '../src/engine/agent/commandCalls';
import { approvePlan } from '../src/engine/agent/planRun';
import { beginOncePass, OverLimitError, withOncePass, withSequenceStepPass } from '../src/engine/budget';
import { setApprover } from '../src/engine/commands';
import { createGeneration } from '../src/engine/jobs';
import { paidSend, resetSendLocks } from '../src/engine/money/paidSend';
import { budgetSnapshotFor, storeTickets } from '../src/engine/money/storeBridge';
import { exactPrice } from '../src/engine/money/ticket';
import { resetActions } from '../src/engine/nodecore/action';
import type { CommandApprovalFeedItem, GenNodeData, ModelSummary, PlanFeedItem, ToolNodeData } from '../src/engine/types';
import { createFakeProvider, type FakeProvider } from './helpers/fakeProvider';

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
  probeMedia: async () => ({ width: 64, height: 64, size: 3 }),
  prepareImageForUpload: async (b: Blob) => b,
  blobToDataUrl: async (b: Blob) => `data:image/png;base64,${btoa(String.fromCharCode(...new Uint8Array(await b.arrayBuffer())))}`,
  jpegThumbnail: async () => undefined,
}));

const paidRef = 'nanogpt::paid-img';
const unpricedRef = 'nanogpt::unpriced-img';
const atlasPricedRef = 'atlas::priced-img';
const atlasInpaintRef = 'atlas::inpaint-img';

let sid: string;
let sid2: string;
let fake: FakeProvider;

function installModels(defaultImageCost = 0.1) {
  fake = createFakeProvider({ defaultImageCost });
  fake.install();

  const fresh = createSession('D+ Neon reattack');
  const other = createSession('D+ Neon other session');
  sid = fresh.id;
  sid2 = other.id;

  const node1: GenNodeData = {
    kind: 'image', title: 'Node 1', prompt: 'node one prompt', modelRef: paidRef,
    settings: { count: 1, advanced: {} }, outputIndex: 0,
  };
  const node2: GenNodeData = {
    kind: 'image', title: 'Node 2', prompt: 'node two prompt', modelRef: unpricedRef,
    settings: { count: 1, advanced: {} }, outputIndex: 0,
  };

  const paidModel = {
    ref: paidRef, provider: 'nanogpt', id: 'paid-img', name: 'Paid image', kind: 'image',
    acceptsText: true, acceptsImage: true, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] },
  } as unknown as ModelSummary;
  const unpricedModel = {
    ref: unpricedRef, provider: 'nanogpt', id: 'unpriced-img', name: 'Unpriced image', kind: 'image',
    acceptsText: true, acceptsImage: true, tags: [],
  } as unknown as ModelSummary;
  const atlasPricedModel = {
    ref: atlasPricedRef, provider: 'atlas', id: 'priced-img', name: 'Atlas priced', kind: 'image',
    acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] },
  } as unknown as ModelSummary;
  const atlasInpaintModel = {
    ref: atlasInpaintRef, provider: 'atlas', id: 'inpaint-img', name: 'Atlas inpaint', kind: 'image',
    acceptsText: true, acceptsImage: true, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] },
  } as unknown as ModelSummary;

  useStore.setState((state) => ({
    activeSessionId: sid,
    sessions: {
      [sid]: {
        ...fresh,
        graph: {
          nodes: [
            { id: 'n1', position: { x: 0, y: 0 }, data: node1 },
            { id: 'n2', position: { x: 200, y: 0 }, data: node2 },
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
        [unpricedRef]: unpricedModel,
        [atlasPricedRef]: atlasPricedModel,
        [atlasInpaintRef]: atlasInpaintModel,
      },
      schemas: {
        [paidRef]: {
          ref: paidRef, params: [], source: 'catalog',
          slots: { prompt: 'prompt', promptRequired: true, images: { key: 'imageDataUrls', min: 0, max: 4, multiple: true, format: 'data-url' } },
        },
        [unpricedRef]: {
          ref: unpricedRef, params: [], source: 'catalog',
          slots: { prompt: 'prompt', promptRequired: true },
        },
        [atlasPricedRef]: {
          ref: atlasPricedRef, params: [], source: 'catalog',
          slots: { prompt: 'prompt', promptRequired: true },
        },
        [atlasInpaintRef]: {
          ref: atlasInpaintRef, params: [], source: 'catalog',
          slots: {
            prompt: 'prompt', promptRequired: true,
            images: { key: 'image', min: 0, max: 1, multiple: false, format: 'url' },
            mask: { key: 'mask_image', required: true, convention: 'white', format: 'url' },
          },
        },
      },
    },
    settings: {
      ...state.settings,
      keys: { ...state.settings.keys, nanogpt: 'test-only', atlas: 'test-only' },
      ops: { ...state.settings.ops, edit: paidRef, editRegion: atlasInpaintRef },
      budgetOn: true, budgetUsd: 1, budgetNoAsk: false, budgetAccepted: null,
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

// --- Findings ---

// reproduce: toolParamAssets (freshness.ts:15-20) only inspects top-level typeof v === 'string' values, skipping array/nested params like _refs: ['ast_ref'] that sendInputs.ts coerces via String(...) and dispatches unreviewed after in-place edits.
it.fails('R1a: invalidates nodes.run.start review when a tool node array param (_refs) asset is edited in-place', async () => {
  blobs.set('ast_src', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }));
  blobs.set('ast_ref', new Blob([new Uint8Array([6, 6, 6, 6])], { type: 'image/png' }));
  const toolData = {
    kind: 'tool', title: 'Relight', op: 'relight',
    params: { preset: 'neon', direction: 'left', intensity: 'medium', _refs: ['ast_ref'] }, outputIndex: 0,
  } as unknown as ToolNodeData;
  useStore.setState((state) => ({
    assets: {
      ...state.assets,
      ast_src: { id: 'ast_src', kind: 'image', mime: 'image/png', width: 64, height: 64, sessionId: sid, origin: 'upload', stored: true, favorite: false, createdAt: 1 },
      ast_ref: { id: 'ast_ref', kind: 'image', mime: 'image/png', width: 64, height: 64, sessionId: sid, origin: 'upload', stored: true, favorite: false, createdAt: 1 },
    },
    sessions: {
      ...state.sessions,
      [sid]: {
        ...state.sessions[sid],
        graph: {
          nodes: [
            { id: 'n_src', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Source', assetId: 'ast_src' } },
            { id: 'n_edit', position: { x: 200, y: 0 }, data: toolData },
          ],
          edges: [{ id: 'e_in', source: 'n_src', target: 'n_edit', sourceHandle: 'out', targetHandle: 'input' }],
        },
      },
    },
  }));

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n_edit'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));
  const card = commandCard();

  const edited = await saveAssetEdit('ast_ref', new Blob([new Uint8Array([9, 8, 7, 6])], { type: 'image/png' }), 'original');
  expect(edited).not.toBeNull();

  expect(decideCommandApproval(sid, card.id, 'approve')).toBe(true);
  await pending;

  expect(fake.acceptedCount('/v1/images'), 'nodes.run.start dispatched edited array _refs bytes without re-review').toBe(0);
  expect(commandCard().status).toBe('awaiting');
});

// reproduce: previewRun (actions.ts:218-230,273,325-331) only records the model3d asset id in assets and assetRevisionIdentity only hashes the viewImageId string, not the viewImageId asset revision that graph.ts:472-478 and sendInputs dispatch.
it.fails('R1b: invalidates nodes.run.start review when an upstream model3d node viewImageId asset is edited in-place', async () => {
  blobs.set('ast_3d', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'model/gltf-binary' }));
  blobs.set('ast_view', new Blob([new Uint8Array([7, 7, 7, 7])], { type: 'image/png' }));
  const imgData: GenNodeData = {
    kind: 'image', title: 'From 3D', prompt: 'render from 3d view', modelRef: paidRef,
    settings: { count: 1, advanced: {} }, outputIndex: 0,
  };
  useStore.setState((state) => ({
    assets: {
      ...state.assets,
      ast_3d: { id: 'ast_3d', kind: 'model3d', mime: 'model/gltf-binary', width: 64, height: 64, sessionId: sid, origin: 'upload', stored: true, favorite: false, createdAt: 1, viewImageId: 'ast_view' },
      ast_view: { id: 'ast_view', kind: 'image', mime: 'image/png', width: 64, height: 64, sessionId: sid, origin: 'frame', stored: true, favorite: false, createdAt: 1 },
    },
    sessions: {
      ...state.sessions,
      [sid]: {
        ...state.sessions[sid],
        graph: {
          nodes: [
            { id: 'n_3d', position: { x: 0, y: 0 }, data: { kind: 'asset', title: '3D Model', assetId: 'ast_3d' } },
            { id: 'n_img', position: { x: 200, y: 0 }, data: imgData },
          ],
          edges: [{ id: 'e_ref', source: 'n_3d', target: 'n_img', sourceHandle: 'out', targetHandle: 'ref' }],
        },
      },
    },
  }));

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n_img'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));
  const card = commandCard();

  const edited = await saveAssetEdit('ast_view', new Blob([new Uint8Array([9, 8, 7, 6])], { type: 'image/png' }), 'original');
  expect(edited).not.toBeNull();

  expect(decideCommandApproval(sid, card.id, 'approve')).toBe(true);
  await pending;

  expect(fake.acceptedCount('render from 3d view'), 'nodes.run.start dispatched edited viewImageId bytes without re-review').toBe(0);
  expect(commandCard().status).toBe('awaiting');
});

// reproduce: evaluateBudgetGate (paidSend.ts:86) returns ok immediately when pass.allowUnknown is true, ignoring pass.maxUsd ($0.10) and letting a $5.00 quote pass on a known-price step in a mixed plan.
it.fails('R2a: blocks a known-price step in a mixed plan approved with once+allowUnknown when quote jumps above the approved cap', async () => {
  // Atlas calculate endpoint returns $5.00 live quote while catalog published $0.10 for s1.
  installModels(5.0);
  useStore.setState((state) => ({
    settings: { ...state.settings, budgetOn: true, budgetUsd: 0.05 },
  }));

  const planItem: PlanFeedItem = {
    id: 'plan-mixed-quote', createdAt: 1, type: 'plan', style: 'auto', workspace: 'chat', status: 'awaiting',
    plan: {
      id: 'pln-mixed-quote', title: 'Mixed plan', summary: '', workspace: 'chat', style: '', subjects: [], adjustments: [],
      steps: [
        { id: 's1', kind: 'image', title: 'Known Atlas', prompt: 'known priced atlas step', modelRef: atlasPricedRef, settings: { count: 1, advanced: {} }, refs: [] },
        { id: 's2', kind: 'image', title: 'Unpriced', prompt: 'unpriced companion step', modelRef: unpricedRef, settings: { count: 1, advanced: {} }, refs: [] },
      ],
    },
    stepStates: {}, stepGenerations: {}, estimate: { usd: 0.1, approximate: true, lowerBound: true },
  };
  useStore.setState((state) => ({
    sessions: { ...state.sessions, [sid]: { ...state.sessions[sid], feed: [planItem] } },
  }));

  await withOncePass(sid, (pass) => approvePlan(sid, planItem.id, pass), 0.1, true);

  expect(storeTickets.get(`plan:${planItem.id}`)?.pass).toMatchObject({ kind: 'once', maxUsd: 0.1, allowUnknown: true });
  expect(fake.acceptedCount('known priced atlas step'), 'once+allowUnknown let a $5.00 quote pass on a plan step approved at $0.10').toBe(0);
});

// reproduce: in a mixed nodes.run.start approved with once+allowUnknown (maxUsd $0.10), evaluateBudgetGate (paidSend.ts:86) ignores pass.maxUsd and createGeneration re-estimates with the live $5.00 quote, dispatching $5.00 on a node reviewed at $0.10.
it.fails('R2b: blocks a known-price node in a mixed nodes.run.start approved with once+allowUnknown when quote jumps above the approved cap', async () => {
  // Atlas calculate endpoint returns $5.00 live quote while user reviewed and approved $0.10 + unpriced.
  installModels(5.0);
  useStore.setState((state) => ({
    settings: { ...state.settings, budgetOn: true, budgetUsd: 0.05 },
    sessions: {
      ...state.sessions,
      [sid]: {
        ...state.sessions[sid],
        graph: {
          nodes: [
            { id: 'n_atlas', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'Atlas Known', prompt: 'known node atlas mixed', modelRef: atlasPricedRef, settings: { count: 1, advanced: {} }, outputIndex: 0 } },
            { id: 'n_unk', position: { x: 200, y: 0 }, data: { kind: 'image', title: 'Unpriced', prompt: 'unpriced node mixed', modelRef: unpricedRef, settings: { count: 1, advanced: {} }, outputIndex: 0 } },
          ],
          edges: [],
        },
      },
    },
  }));

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n_atlas', 'n_unk'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));
  const card = commandCard();
  expect(card.estimate.usd).toBe(0.1);

  expect(decideCommandApproval(sid, card.id, 'once')).toBe(true);
  await pending;

  expect(storeTickets.get(`cmd:${card.id}`)?.pass).toMatchObject({ kind: 'once', maxUsd: 0.1, allowUnknown: true });
  expect(fake.acceptedCount('known node atlas mixed'), 'once+allowUnknown let a $5.00 quote pass on a node approved at $0.10').toBe(0);
});

// reproduce: evaluateBudgetGate (paidSend.ts:86) bypasses cumulative ticketCommittedUsd/pass.maxUsd checks whenever pass.allowUnknown is true and command tickets never clear pass on completion, allowing unlimited extra sends on a spent once pass.
it.fails('R2c: rejects an extra paid send on a once+allowUnknown command ticket after its approved sends already ran', async () => {
  useStore.setState((state) => ({ settings: { ...state.settings, budgetOn: true, budgetUsd: 0.05 } }));

  const pending = runCommandsTool(sid, {
    seq: [
      { cmd: 'nodes.run.start', args: { targets: ['n1'], force: true } },
      { cmd: 'nodes.run.start', args: { targets: ['n2'], force: true } },
    ],
  });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));
  const card = commandCard();

  expect(decideCommandApproval(sid, card.id, 'once')).toBe(true);
  await pending;
  expect(commandCard().status).toBe('done');
  expect(fake.acceptedCount('node one prompt')).toBe(1);
  expect(fake.acceptedCount('node two prompt')).toBe(1);

  const ticketId = `cmd:${card.id}`;
  expect(storeTickets.get(ticketId)).toBeDefined();

  // Attempting a third, unapproved $1.00 send on the same once+allowUnknown ticket must be blocked:
  await expect(
    paidSend({
      ticketId,
      prepare: { id: 'snd_extra_unapproved', slotKey: 'extra:0', price: exactPrice(1.0) },
      tickets: storeTickets,
      getBudget: () => budgetSnapshotFor(sid),
      save: async () => undefined,
      onBookSpend: () => undefined,
      send: async () => ({ value: 'extra', costUsd: 1.0 }),
    }),
  ).rejects.toMatchObject({ name: 'PaidSendBlockedError' });
});

// --- Controls ("Sin hallazgo (comprobado)") ---

it('control: invalidates nodes.run.start when an upstream completed tool node output is edited in-place', async () => {
  blobs.set('ast_src', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }));
  blobs.set('ast_mask', new Blob([new Uint8Array([5, 5, 5, 5])], { type: 'image/png' }));
  blobs.set('ast_up', new Blob([new Uint8Array([8, 8, 8, 8])], { type: 'image/png' }));
  const upTool: ToolNodeData = {
    kind: 'tool', title: 'Upstream Edit', op: 'edit_region',
    params: { mask: 'ast_mask', instruction: 'upstream mask' }, outputIndex: 0, generationId: 'gen_up',
  };
  const downImg: GenNodeData = {
    kind: 'image', title: 'Downstream', prompt: 'downstream prompt', modelRef: paidRef,
    settings: { count: 1, advanced: {} }, outputIndex: 0,
  };
  useStore.setState((state) => ({
    assets: {
      ...state.assets,
      ast_src: { id: 'ast_src', kind: 'image', mime: 'image/png', width: 64, height: 64, sessionId: sid, origin: 'upload', stored: true, favorite: false, createdAt: 1 },
      ast_mask: { id: 'ast_mask', kind: 'image', mime: 'image/png', width: 64, height: 64, sessionId: sid, origin: 'mask', stored: true, favorite: false, createdAt: 1 },
      ast_up: { id: 'ast_up', kind: 'image', mime: 'image/png', width: 64, height: 64, sessionId: sid, origin: 'generated', stored: true, favorite: false, createdAt: 2 },
    },
    generations: {
      gen_up: {
        id: 'gen_up', sessionId: sid, kind: 'image', prompt: 'upstream mask', modelRef: atlasInpaintRef, modelName: 'Atlas inpaint',
        provider: 'atlas', settings: { count: 1, advanced: {} }, inputs: { refs: [] },
        op: { id: 'edit_region', params: { mask: 'ast_mask', instruction: 'upstream mask' }, sourceAssetId: 'ast_src' },
        origin: 'node', stepId: 'n_up', status: 'done', assetIds: ['ast_up'], estimate: { usd: 0.1, approximate: false }, createdAt: 1,
      },
    },
    sessions: {
      ...state.sessions,
      [sid]: {
        ...state.sessions[sid],
        graph: {
          nodes: [
            { id: 'n_src', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Source', assetId: 'ast_src' } },
            { id: 'n_up', position: { x: 200, y: 0 }, data: upTool },
            { id: 'n_down', position: { x: 400, y: 0 }, data: downImg },
          ],
          edges: [
            { id: 'e1', source: 'n_src', target: 'n_up', sourceHandle: 'out', targetHandle: 'input' },
            { id: 'e2', source: 'n_up', target: 'n_down', sourceHandle: 'out', targetHandle: 'ref' },
          ],
        },
      },
    },
  }));

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n_down'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));
  const card = commandCard();

  expect(await saveAssetEdit('ast_up', new Blob([new Uint8Array([9, 9, 9, 9])], { type: 'image/png' }), 'original')).not.toBeNull();

  expect(decideCommandApproval(sid, card.id, 'approve')).toBe(true);
  await pending;
  expect(fake.acceptedCount('downstream prompt')).toBe(0);
  expect(commandCard().status).toBe('awaiting');
});

it('control: invalidates nodes.run.start when a node-bound subject asset (subjects with asset:) is edited in-place', async () => {
  blobs.set('ast_subj', new Blob([new Uint8Array([3, 3, 3, 3])], { type: 'image/png' }));
  const imgData: GenNodeData = {
    kind: 'image', title: 'Subject Node', prompt: 'photo of @Hero', modelRef: paidRef,
    settings: { count: 1, advanced: {} }, outputIndex: 0,
    subjects: [{ name: 'Hero', from: 'asset:ast_subj', kind: 'character' }],
  };
  useStore.setState((state) => ({
    assets: {
      ...state.assets,
      ast_subj: { id: 'ast_subj', kind: 'image', mime: 'image/png', width: 64, height: 64, sessionId: sid, origin: 'upload', stored: true, favorite: false, createdAt: 1 },
    },
    sessions: {
      ...state.sessions,
      [sid]: { ...state.sessions[sid], graph: { nodes: [{ id: 'n_subj', position: { x: 0, y: 0 }, data: imgData }], edges: [] } },
    },
  }));

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n_subj'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));
  const card = commandCard();

  expect(await saveAssetEdit('ast_subj', new Blob([new Uint8Array([4, 4, 4, 4])], { type: 'image/png' }), 'original')).not.toBeNull();

  expect(decideCommandApproval(sid, card.id, 'approve')).toBe(true);
  await pending;
  expect(fake.acceptedCount('photo of @Hero')).toBe(0);
  expect(commandCard().status).toBe('awaiting');
});

it('control: once+allowUnknown pass and command ticket in session 1 cannot authorize spending in session 2', async () => {
  useStore.setState((state) => ({ settings: { ...state.settings, budgetOn: true, budgetUsd: 0.05 } }));

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n2'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));
  const card = commandCard();

  expect(decideCommandApproval(sid2, card.id, 'once')).toBe(false);
  expect(decideCommandApproval(sid, card.id, 'once')).toBe(true);
  await pending;

  const cmdTicketId = `cmd:${card.id}`;
  expect(() => withOncePass(sid, (pass) => createGeneration({
    sessionId: sid2, kind: 'image', modelRef: paidRef, prompt: 'cross session spend',
    settings: { count: 1, advanced: {} }, origin: 'composer',
    estimate: { usd: 0.1, approximate: false }, budgetPass: pass, approvalTicketId: cmdTicketId,
  }), null, true)).toThrow(OverLimitError);
  expect(fake.acceptedCount('cross session spend')).toBe(0);
});

it('control: without allowUnknown, nodes.run.start blocks a $5.00 Atlas quote on a $0.10 known-price node via PASS_EXCEEDED', async () => {
  installModels(5.0);
  useStore.setState((state) => ({
    settings: { ...state.settings, budgetOn: true, budgetUsd: 0.05 },
    sessions: {
      ...state.sessions,
      [sid]: {
        ...state.sessions[sid],
        graph: {
          nodes: [
            { id: 'n_atlas', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'Atlas Known Solo', prompt: 'known node atlas solo', modelRef: atlasPricedRef, settings: { count: 1, advanced: {} }, outputIndex: 0 } },
          ],
          edges: [],
        },
      },
    },
  }));

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n_atlas'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));
  expect(decideCommandApproval(sid, commandCard().id, 'once')).toBe(true);
  await pending;

  expect(fake.acceptedCount('known node atlas solo')).toBe(0);
});

it('control: in-memory sequence once pass (beginOncePass) exhausts its approved USD and unknown slots and blocks extra steps', () => {
  useStore.setState((state) => ({ settings: { ...state.settings, budgetOn: true, budgetUsd: 0.05 } }));
  const grant = beginOncePass(sid, 0.1, 1);
  try {
    withSequenceStepPass(grant.pass, sid, { usd: 0.1, approximate: false }, { usd: 0.1, approximate: false }, () => 'ok1');
    withSequenceStepPass(grant.pass, sid, { usd: null, approximate: true }, { usd: null, approximate: true }, () => 'ok2');
    expect(() =>
      withSequenceStepPass(grant.pass, sid, { usd: 0.1, approximate: false }, { usd: 0.1, approximate: false }, () => 'nope'),
    ).toThrow(OverLimitError);
    expect(() =>
      withSequenceStepPass(grant.pass, sid, { usd: null, approximate: true }, { usd: null, approximate: true }, () => 'nope2'),
    ).toThrow(OverLimitError);
  } finally {
    grant.end();
  }
});
