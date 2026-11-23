// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import '../src/engine/commands';
import { createSession, useStore } from '../src/store/store';
import { useAlerts } from '../src/engine/alerts';
import { saveAssetEdit } from '../src/engine/assetRevisions';
import { decideCommandApproval, runCommandsTool } from '../src/engine/agent/commandCalls';
import { withOncePass } from '../src/engine/budget';
import { setApprover } from '../src/engine/commands';
import { createGeneration, runGeneration } from '../src/engine/jobs';
import { resetSendLocks } from '../src/engine/money/paidSend';
import { resetActions } from '../src/engine/nodecore/action';
import type { CommandApprovalFeedItem, GenNodeData, ModelSummary, ToolNodeData } from '../src/engine/types';
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
const atlasUnpricedRef = 'atlas::unpriced-img';
const atlasInpaintRef = 'atlas::inpaint-img';

let sid: string;
let fake: FakeProvider;

beforeEach(() => {
  blobs.clear();
  resetSendLocks();
  resetActions();
  useAlerts.setState({ alerts: [] });
  setApprover(null);
  fake = createFakeProvider({ defaultImageCost: 0.1 });
  fake.install();

  const fresh = createSession('D+ Neon final attack');
  sid = fresh.id;

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
  const atlasUnpricedModel = {
    ref: atlasUnpricedRef, provider: 'atlas', id: 'unpriced-img', name: 'Atlas unpriced', kind: 'image',
    acceptsText: true, acceptsImage: false, tags: [],
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
    },
    generations: {}, tickets: {}, spendLog: [], spentUsd: 0, quotes: {}, assets: {}, library: [],
    catalog: {
      ...state.catalog,
      models: {
        [paidRef]: paidModel,
        [unpricedRef]: unpricedModel,
        [atlasUnpricedRef]: atlasUnpricedModel,
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
        [atlasUnpricedRef]: {
          ref: atlasUnpricedRef, params: [], source: 'catalog',
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
});

afterEach(() => {
  blobs.clear();
  useAlerts.setState({ alerts: [] });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('F1a: invalidates nodes.run.start review when a tool node mask asset (params.mask) is edited in-place', async () => {
  blobs.set('ast_src', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }));
  blobs.set('ast_mask', new Blob([new Uint8Array([5, 5, 5, 5])], { type: 'image/png' }));
  const toolData: ToolNodeData = {
    kind: 'tool', title: 'Edit region', op: 'edit_region',
    params: { mask: 'ast_mask', instruction: 'fill sky with clouds' }, outputIndex: 0,
  };
  useStore.setState((state) => ({
    assets: {
      ...state.assets,
      ast_src: { id: 'ast_src', kind: 'image', mime: 'image/png', width: 64, height: 64, sessionId: sid, origin: 'upload', stored: true, favorite: false, createdAt: 1 },
      ast_mask: { id: 'ast_mask', kind: 'image', mime: 'image/png', width: 64, height: 64, sessionId: sid, origin: 'mask', stored: true, favorite: false, createdAt: 1 },
    },
    sessions: {
      ...state.sessions,
      [sid]: {
        ...state.sessions[sid],
        graph: {
          nodes: [
            { id: 'n_src', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Source', assetId: 'ast_src' } },
            { id: 'n_inpaint', position: { x: 200, y: 0 }, data: toolData },
          ],
          edges: [{ id: 'e_in', source: 'n_src', target: 'n_inpaint', sourceHandle: 'out', targetHandle: 'input' }],
        },
      },
    },
  }));

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n_inpaint'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));
  const card = commandCard();

  const edited = await saveAssetEdit('ast_mask', new Blob([new Uint8Array([9, 8, 7, 6])], { type: 'image/png' }), 'original');
  expect(edited).not.toBeNull();

  expect(decideCommandApproval(sid, card.id, 'approve')).toBe(true);
  await pending;

  expect(fake.acceptedCount('fill sky with clouds'), 'nodes.run.start dispatched edited mask bytes without re-review').toBe(0);
  expect(commandCard().status).toBe('awaiting');
});

it('F1b: invalidates nodes.run.start review when a tool node reference asset (params._refs) is edited in-place', async () => {
  blobs.set('ast_src', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }));
  blobs.set('ast_ref', new Blob([new Uint8Array([6, 6, 6, 6])], { type: 'image/png' }));
  const toolData: ToolNodeData = {
    kind: 'tool', title: 'Relight', op: 'relight',
    params: { preset: 'neon', direction: 'left', intensity: 'medium', _refs: 'ast_ref' }, outputIndex: 0,
  };
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

  expect(fake.acceptedCount('/v1/images'), 'nodes.run.start dispatched edited _refs bytes without re-review').toBe(0);
  expect(commandCard().status).toBe('awaiting');
});

// reproduce: ticketPassFromEstimate emits maxUsd: null with allowUnknown: true for mixed priced + unpriced totals, and evaluateBudgetGate rejects any priced step when pass.maxUsd is null, deadlocking the user under Allow this time.
it.fails('F2a: allows mixed priced + unpriced approved command sequence to run under "Allow this time" without PASS_EXCEEDED deadlock', async () => {
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
  expect(fake.acceptedCount('node one prompt'), 'priced step in approved mixed sequence was blocked by PASS_EXCEEDED').toBe(1);
  expect(fake.acceptedCount('node two prompt'), 'unpriced step in approved mixed sequence never ran').toBe(1);
});

// reproduce: approving an unpriced generation with Continue once sets pass.maxUsd: null, and when requestQuote returns an exact price evaluateBudgetGate fails with PASS_EXCEEDED, deadlocking the user without a way to run once.
it.fails('F2b: allows an unpriced generation approved with "Continue once" to run when requestQuote returns an exact price', async () => {
  useStore.setState((state) => ({ settings: { ...state.settings, budgetOn: true, budgetUsd: 0.05 } }));

  const g = withOncePass(sid, (pass) => createGeneration({
    sessionId: sid, kind: 'image', modelRef: atlasUnpricedRef, prompt: 'quoted unknown model',
    settings: { count: 1, advanced: {} }, origin: 'composer',
    estimate: { usd: null, approximate: true }, budgetPass: pass,
  }), null);

  await runGeneration(g.id);

  expect(fake.acceptedCount('quoted unknown model'), 'Continue once on unpriced model was deadlocked by PASS_EXCEEDED once Atlas returned an exact quote').toBe(1);
  expect(useStore.getState().generations[g.id]?.status).toBe('done');
});
