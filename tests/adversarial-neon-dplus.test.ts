// @vitest-environment jsdom
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// @ts-expect-error The checker is a .mjs script with no declaration.
import { check as rawCheck } from '../scripts/check-paid-send.mjs';
import '../src/engine/commands';
import { createSession, setComposer, setComposerMedia, upsertTicket, useStore } from '../src/store/store';
import { useAlerts } from '../src/engine/alerts';
import { deleteGeneration } from '../src/engine/assetActions';
import { saveAssetEdit } from '../src/engine/assetRevisions';
import { decideCommandApproval, runCommandsTool } from '../src/engine/agent/commandCalls';
import { retryAgentTurn } from '../src/engine/agent/conversation';
import { approvePlan, llmTurn, resumePlan, settleInterruptedPlans } from '../src/engine/agent/runtime';
import { remainingBudget, withOncePass } from '../src/engine/budget';
import { setApprover } from '../src/engine/commands';
import { createDoc, newRasterLayer } from '../src/engine/design/doc';
import { setBuffer } from '../src/engine/design/raster';
import { place } from '../src/engine/design/rasterSurface';
import { patchNodeData } from '../src/engine/flow/actions';
import { canRecheck, createGeneration, isRunning, recheckGeneration, resumeInterrupted, retryGeneration, runGeneration } from '../src/engine/jobs';
import { sendLlmViaPaidGate } from '../src/engine/money/llmSend';
import { resetSendLocks } from '../src/engine/money/paidSend';
import { reconcileUnknownCharge, sendGenerationViaPaidGate } from '../src/engine/money/storeBridge';
import { createTicket, exactPrice } from '../src/engine/money/ticket';
import type { CommandApprovalFeedItem, GenNodeData, ModelSummary, PlanFeedItem } from '../src/engine/types';
import { createFakeProvider, jsonResponse, simulateReload, snapshotStore, sseResponse, type FakeProvider } from './helpers/fakeProvider';

const blobs = vi.hoisted(() => new Map<string, Blob>());
const idbHooks = vi.hoisted(() => ({
  failNextPut: false,
  failNextStateSave: false,
  holdBlobRead: null as null | { id: string; gate: Promise<void>; arrived: () => void },
}));

vi.mock('../src/lib/idb', () => ({
  stateDb: {
    get: async () => null,
    set: async () => {
      if (idbHooks.failNextStateSave) {
        idbHooks.failNextStateSave = false;
        throw new Error('IDB write failed');
      }
      return { ok: true };
    },
    del: async () => undefined,
  },
  cacheDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  getAssetBlob: async (id: string) => {
    if (idbHooks.holdBlobRead && idbHooks.holdBlobRead.id === id) {
      const { gate, arrived } = idbHooks.holdBlobRead;
      idbHooks.holdBlobRead = null;
      arrived();
      await gate;
    }
    return blobs.get(id) ?? new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
  },
  putAssetBlob: async (id: string, blob: Blob) => {
    if (idbHooks.failNextPut) {
      idbHooks.failNextPut = false;
      throw new Error('Simulated IDB blob quota failure');
    }
    blobs.set(id, blob);
  },
  deleteAssetBlobs: async (ids: string[]) => {
    for (const id of ids) blobs.delete(id);
  },
}));

vi.mock('../src/lib/media', async (original) => ({
  ...(await original<typeof import('../src/lib/media')>()),
  probeMedia: async () => ({ width: 64, height: 64, size: 3 }),
  prepareImageForUpload: async (b: Blob) => b,
  blobToDataUrl: async (b: Blob) => `data:image/png;base64,${btoa(String.fromCharCode(...new Uint8Array(await b.arrayBuffer())))}`,
  jpegThumbnail: async () => undefined,
}));

const check = rawCheck as (root: string) => string[];
const modelRef = 'nanogpt::paid-img';
const atlasRef = 'atlas::paid-img';
const llmModel = 'paid-llm';
let sid: string;
let fake: FakeProvider;

beforeEach(() => {
  blobs.clear();
  idbHooks.failNextPut = false;
  idbHooks.failNextStateSave = false;
  idbHooks.holdBlobRead = null;
  resetSendLocks();
  useAlerts.setState({ alerts: [] });
  setApprover(null);
  fake = createFakeProvider();
  fake.install();
  const fresh = createSession('D+ Neon adversarial');
  sid = fresh.id;
  const node1: GenNodeData = {
    kind: 'image', title: 'Node 1', prompt: 'node one prompt', modelRef,
    settings: { count: 1, advanced: {} }, outputIndex: 0,
  };
  const node2: GenNodeData = {
    kind: 'image', title: 'Node 2', prompt: 'node two prompt', modelRef,
    settings: { count: 1, advanced: {} }, outputIndex: 0,
  };
  const paidModel = {
    ref: modelRef, provider: 'nanogpt', id: 'paid-img', name: 'Paid image', kind: 'image',
    acceptsText: true, acceptsImage: true, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] },
  } as unknown as ModelSummary;
  const atlasModel = {
    ref: atlasRef, provider: 'atlas', id: 'paid-img', name: 'Atlas image', kind: 'image',
    acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'output', usd: 0.2 }] },
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
      models: { [modelRef]: paidModel, [atlasRef]: atlasModel },
      schemas: {
        [modelRef]: { ref: modelRef, params: [], slots: { prompt: 'prompt', promptRequired: true, images: { key: 'imageDataUrls', min: 0, max: 4, multiple: true, format: 'data-url' } }, source: 'catalog' },
        [atlasRef]: { ref: atlasRef, params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' },
      },
      llm: { ...state.catalog.llm, nanogpt: [{ id: llmModel, name: 'Paid LLM', inputPrice: 20, outputPrice: 40, tools: true, vision: false }] as never },
      llmStatus: { openrouter: 'idle', nanogpt: 'ready', atlas: 'idle' },
    },
    settings: {
      ...state.settings,
      keys: { ...state.settings.keys, nanogpt: 'test-only', atlas: 'test-only' },
      agent: { ...state.settings.agent, provider: 'nanogpt', model: llmModel, effort: 'none' },
      ops: { ...state.settings.ops, edit: modelRef },
      budgetOn: true, budgetUsd: 1, budgetNoAsk: false, budgetAccepted: null,
    },
  }));
});

afterEach(() => {
  blobs.clear();
  idbHooks.failNextPut = false;
  idbHooks.failNextStateSave = false;
  idbHooks.holdBlobRead = null;
  useAlerts.setState({ alerts: [] });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function scanFixture(file: string, content: string): string[] {
  const root = mkdtempSync(join(tmpdir(), 'ogs-dplus-neon-'));
  try {
    const target = join(root, file);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content);
    return check(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function makeFakeCanvas(bytes: number[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  place(canvas, { x0: 0, y0: 0, fw: 16, fh: 16 });
  Object.defineProperty(canvas, 'toBlob', {
    configurable: true,
    value: (cb: (b: Blob | null) => void) => cb(new Blob([new Uint8Array(bytes)], { type: 'image/png' })),
  });
  return canvas;
}

// --- Findings ---

// reproduce: deliverGenerated omits asset revisions for upstream generated assets, so editing the asset in-place keeps preview.signature identical and dispatches unreviewed bytes.
it.fails('N1: invalidates nodes.run.start review when an upstream generated node asset is edited in-place', async () => {
  blobs.set('asset_up', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }));
  useStore.setState((state) => ({
    assets: {
      ...state.assets,
      asset_up: {
        id: 'asset_up', kind: 'image', mime: 'image/png', width: 64, height: 64,
        sessionId: sid, origin: 'generated', stored: true, favorite: false, createdAt: 1,
      },
    },
    generations: {
      ...state.generations,
      g_up: {
        id: 'g_up', sessionId: sid, kind: 'image', prompt: 'upstream image', modelRef, modelName: 'Paid image',
        provider: 'nanogpt', settings: { count: 1, advanced: {} }, inputs: { refs: [] },
        origin: 'node', status: 'done', assetIds: ['asset_up'], estimate: { usd: 0.1, approximate: false }, createdAt: 1,
      },
    },
    sessions: {
      ...state.sessions,
      [sid]: {
        ...state.sessions[sid],
        graph: {
          nodes: [
            { id: 'n1', position: { x: 0, y: 0 }, data: { ...(state.sessions[sid].graph.nodes[0].data as GenNodeData), generationId: 'g_up' } },
            state.sessions[sid].graph.nodes[1],
          ],
          edges: [{ id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'out', targetHandle: 'ref' }],
        },
      },
    },
  }));
  patchNodeData(sid, 'n2', { prompt: 'restyle upstream' });

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n2'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));
  const card = commandCard();

  const saved = snapshotStore();
  simulateReload(null, { sessionId: sid, state: saved });
  settleInterruptedPlans();
  void pending.catch(() => undefined);

  const edited = await saveAssetEdit('asset_up', new Blob([new Uint8Array([9, 8, 7, 6])], { type: 'image/png' }), 'original');
  expect(edited).not.toBeNull();

  expect(decideCommandApproval(sid, card.id, 'approve')).toBe(true);
  await vi.waitFor(() => expect(commandCard().status).not.toBe('running'));
  expect(fake.acceptedCount('restyle upstream'), 'restored nodes.run.start dispatched edited upstream asset bytes without re-review').toBe(0);
  expect(commandCard().status).toBe('awaiting');
});

// reproduce: commandReview hashes doc.layers metadata without raster bufferVersion, so mutating a raster layer pixel buffer keeps signature identical and sends modified pixels without re-review.
it.fails('N2: invalidates studio.layer.run_op review when raster layer pixel buffer changes without changing layer metadata', async () => {
  const doc = createDoc('Test doc', 16, 16);
  const layer = newRasterLayer('Paint', { x: 0, y: 0, width: 16, height: 16 }, { width: 16, height: 16 });
  doc.layers = [layer];
  doc.activeLayerId = layer.id;
  setBuffer(layer.id, makeFakeCanvas([1, 2, 3, 4]), false);
  useStore.setState((state) => ({
    sessions: { ...state.sessions, [sid]: { ...state.sessions[sid], docs: [doc], activeDocId: doc.id } },
  }));

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'studio.layer.run_op', args: { docId: doc.id, layerId: layer.id, op: 'relight', params: { preset: 'neon', direction: 'left', intensity: 'medium' } } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));
  const card = commandCard();

  // Mutate the layer's pixel buffer in raster.ts (bumps bufferVersion) without altering doc.layers metadata.
  setBuffer(layer.id, makeFakeCanvas([9, 9, 9, 9]), false);

  expect(decideCommandApproval(sid, card.id, 'approve')).toBe(true);
  await pending;
  expect(fake.acceptedCount('/v1/images'), 'studio.layer.run_op sent modified raster buffer pixels without re-review').toBe(0);
  expect(commandCard().status).toBe('awaiting');
});

// reproduce: recheckGeneration sets status='running' before followRemote exits early on isRemoteJobDoneOnTicket, trapping a generation whose local output storage failed in permanent 'running'.
it.fails('N3: does not trap a generation permanently in running when Check status is clicked after local output storage failed on a settled remoteJob', async () => {
  idbHooks.failNextPut = true;

  const g = createGeneration({
    sessionId: sid, kind: 'image', modelRef: atlasRef, prompt: 'atlas remote image',
    settings: { count: 1, advanced: {} }, origin: 'composer', estimate: { usd: 0.2, approximate: false },
  });
  await expect(runGeneration(g.id)).rejects.toThrow(/quota/i);

  const failed = useStore.getState().generations[g.id];
  expect(failed.status).toBe('error');
  expect(canRecheck(failed)).toBe(true);

  await recheckGeneration(g.id);
  const after = useStore.getState().generations[g.id];
  expect(after.status, 'generation remained stuck in running ("Checking") with no active follower').not.toBe('running');
  expect(isRunning(g.id)).toBe(false);
});

// reproduce: resumePlan consumes budgetPass without updating plan:<id>.pass, so step 2 of a recovered plan is blocked by OVER_LIMIT despite the user's Continue once approval.
it.fails('N4: updates plan ticket pass ceiling when user approves Continue once on resumePlan so dependent steps are not blocked', async () => {
  useStore.setState((state) => ({ settings: { ...state.settings, budgetUsd: 0.2 } }));
  const item: PlanFeedItem = {
    id: 'plan-2step', createdAt: 1, type: 'plan', style: 'auto', workspace: 'chat', status: 'awaiting',
    plan: {
      id: 'pln_2step', title: 'Two-step plan', summary: 'Two paid steps', workspace: 'chat',
      steps: [
        { id: 's1', title: 'Step 1', kind: 'image', prompt: 'step one', modelRef, settings: { count: 1, advanced: {} }, refs: [] },
        { id: 's2', title: 'Step 2', kind: 'image', prompt: 'step two', modelRef, settings: { count: 1, advanced: {} }, refs: ['step:s1'] },
      ],
      adjustments: [],
    },
    estimate: { usd: 0.2, approximate: false },
    stepStates: {},
    stepGenerations: {},
  };
  useStore.setState((state) => ({
    sessions: { ...state.sessions, [sid]: { ...state.sessions[sid], feed: [item] } },
  }));

  // First run is within the $0.20 limit (plan ticket gets no pass); step 1 fails uncertain, holding $0.10.
  fake.onNext('step one', 'cut-after-accept');
  await approvePlan(sid, item.id);
  expect(remainingBudget()).toBeCloseTo(0.1, 6);
  const failedPlan = () => useStore.getState().sessions[sid].feed.find((f): f is PlanFeedItem => f.id === item.id)!;
  expect(failedPlan().status).toBe('error');

  // User confirms "Continue once · $0.20" on PlanRecoveryChips -> resumePlan with once pass.
  await withOncePass(sid, (pass) => resumePlan(sid, item.id, 'retry', true, pass), 0.2);

  expect(fake.acceptedCount('step one')).toBe(2);
  expect(fake.acceptedCount('step two'), 'step 2 was blocked by OVER_LIMIT because resumePlan never updated plan:<id>.pass').toBe(1);
  expect(failedPlan().status).toBe('done');
});

// reproduce: runNodes overwrites and then clears pass on the shared cmd:<id> ticket in finally, blocking subsequent paid steps approved under Allow this time with OVER_LIMIT.
it.fails('N5: preserves command ticket once pass across nodes.run.start followed by studio.generate.start in one approved sequence', async () => {
  useStore.setState((state) => ({ settings: { ...state.settings, budgetUsd: 0.15 } }));
  setComposer({ text: 'studio after node' });
  setComposerMedia('image', { modelRef });
  patchNodeData(sid, 'n1', { prompt: 'node first' });

  const pending = runCommandsTool(sid, {
    seq: [
      { cmd: 'nodes.run.start', args: { targets: ['n1'], force: true } },
      { cmd: 'studio.generate.start', args: { kind: 'image' } },
    ],
  });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));
  const card = commandCard();

  expect(decideCommandApproval(sid, card.id, 'once')).toBe(true);
  await pending;
  await vi.waitFor(() => {
    const gens = Object.values(useStore.getState().generations);
    expect(gens.length).toBeGreaterThanOrEqual(2);
    expect(gens.every((g) => g.status === 'done' || g.status === 'error')).toBe(true);
  });

  expect(fake.acceptedCount('node first')).toBe(1);
  expect(fake.acceptedCount('studio after node'), 'runNodes cleared cmd:<id>.pass in finally, blocking the second approved command').toBe(1);
});

// reproduce: decideCommandApproval('cancel') unconditionally removes cmd:<id>, dropping uncertain reservations from earlier interrupted steps and breaking reconcileUnknownCharge.
it.fails('N6: canceling a reloaded command card preserves uncertain reservations from already-sent steps and keeps reconciliation working', async () => {
  const held = fake.holdNext('node one prompt');
  const pending = runCommandsTool(sid, {
    seq: [
      { cmd: 'nodes.run.start', args: { targets: ['n1'], force: true } },
      { cmd: 'nodes.run.start', args: { targets: ['n2'], force: true } },
    ],
  });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));
  const card = commandCard();

  expect(decideCommandApproval(sid, card.id, 'approve')).toBe(true);
  await held.arrived;
  const saved = snapshotStore();
  held.resolve(jsonResponse({ data: [{ b64_json: 'AAAA' }], cost: 0.1 }));
  void pending.catch(() => undefined);

  simulateReload(null, { sessionId: sid, state: saved });
  await resumeInterrupted();
  settleInterruptedPlans();

  expect(commandCard().status).toBe('awaiting');
  expect(remainingBudget()).toBeCloseTo(0.9, 6);

  // User cancels the remaining pending step 2.
  decideCommandApproval(sid, card.id, 'cancel');

  expect(remainingBudget(), 'canceling the reloaded card deleted cmd:<id> and dropped the $0.10 uncertain reservation').toBeCloseTo(0.9, 6);
  expect(reconcileUnknownCharge(sid, `cmd:${card.id}`), 'durable reconciliation notice became broken after cancel').toBe(true);
});

// reproduce: generateDirect in chat closes the command card before runGeneration enters paidSend, so compactApprovalTickets evicts cmd:<id> and drops its once pass.
it.fails('N7: does not compact away an approved cmd:<id> ticket and its once pass while studio.generate.start generation is still starting', async () => {
  useStore.setState((state) => ({
    settings: { ...state.settings, budgetUsd: 0.05 },
    assets: {
      ...state.assets,
      asset_att: {
        id: 'asset_att', kind: 'image', mime: 'image/png', width: 64, height: 64,
        sessionId: sid, origin: 'upload', stored: true, favorite: false, createdAt: 1,
      },
    },
  }));
  setComposer({ text: 'chat direct image', attachments: ['asset_att'] });
  setComposerMedia('image', { modelRef });

  let releaseBlob!: () => void;
  const blobGate = new Promise<void>((resolve) => { releaseBlob = resolve; });
  let blobArrived!: () => void;
  const onBlobArrived = new Promise<void>((resolve) => { blobArrived = resolve; });
  idbHooks.holdBlobRead = { id: 'asset_att', gate: blobGate, arrived: blobArrived };

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'studio.generate.start', args: { kind: 'image' } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));
  const card = commandCard();

  expect(decideCommandApproval(sid, card.id, 'once')).toBe(true);
  await pending;
  await onBlobArrived;
  // generateDirect returned and closed the command card to 'done' while runGeneration is still preparing inputs.
  // 17 subsequent ticket writes trigger compactApprovalTickets(..., 16), evicting cmd:<id> and its once pass.
  for (let i = 0; i < 17; i++) {
    upsertTicket(createTicket({ id: `llm:after-${i}`, sessionId: sid, kind: 'llm', price: exactPrice(0.01) }));
  }
  releaseBlob();

  await vi.waitFor(() => {
    const g = Object.values(useStore.getState().generations)[0];
    expect(g).toBeDefined();
    expect(g.status === 'done' || g.status === 'error').toBe(true);
  });

  expect(fake.acceptedCount('chat direct image'), 'cmd:<id> ticket was compacted before runGeneration reached paidSend, dropping the once pass').toBe(1);
});

// reproduce: deleteGeneration removes generations[id], causing remainingBudget/storeTickets.list/compactApprovalTickets to ignore or drop the uncertain gen:<id> reservation without booking spend.
it.fails('N8: deleting a failed generation with an uncertain charge keeps its reservation until explicitly reconciled', async () => {
  fake.onNext('test uncertain', 'cut-after-accept');
  const g = createGeneration({
    sessionId: sid, kind: 'image', modelRef, prompt: 'test uncertain',
    settings: { count: 1, advanced: {} }, origin: 'composer', estimate: { usd: 0.1, approximate: false },
  });
  await expect(runGeneration(g.id)).rejects.toThrow();
  expect(remainingBudget()).toBeCloseTo(0.9, 6);

  deleteGeneration(g.id);
  expect(remainingBudget(), 'deleting the generation card evaporated the $0.10 uncertain reservation without booking spend').toBeCloseTo(0.9, 6);
  expect(useStore.getState().spendLog).toHaveLength(0);
});

// reproduce: check-paid-send does not restrict src/lib/http requestJson/fetchJsonWithRelay outside provider modules, allowing direct paid POSTs via providerFetch.
it.fails('N9a: check-paid-send flags importing requestJson from src/lib/http outside provider modules', () => {
  const diagnostics = scanFixture('src/engine/rogueHttp.ts', [
    "import { requestJson } from '../lib/http';",
    "export const send = () => requestJson('https://nano-gpt.com/api/v1/images', { method: 'POST', body: '{}' });",
  ].join('\n'));
  expect(diagnostics.join('\n')).toMatch(/rogueHttp\.ts:.*paidSend/);
});

// reproduce: check-paid-send reads source?.value and misses static TemplateLiteral dynamic imports such as import(`./providers/llm`).
it.fails('N9b: check-paid-send flags dynamic import() using a static template literal for a raw provider module', () => {
  const diagnostics = scanFixture('src/engine/rogueTplImport.ts', [
    'export async function send(input: unknown) {',
    '  const { chat } = await import(`./providers/llm`);',
    '  return chat(input as never);',
    '}',
  ].join('\n'));
  expect(diagnostics.join('\n')).toMatch(/rogueTplImport\.ts:.*paidSend/);
});

// reproduce: check-paid-send misses constant string concatenation in dynamic import() and aliased require() calls targeting raw provider modules.
it.fails('N9c: check-paid-send flags dynamic import() with constant string concatenation or aliased require() of raw providers', () => {
  const diagnostics = scanFixture('src/engine/rogueConcatImport.ts', [
    "export const a = () => import('./providers/' + 'llm');",
    "const req = require;",
    "export const b = () => req('./providers/nanogpt');",
  ].join('\n'));
  expect(diagnostics.length).toBeGreaterThanOrEqual(2);
});

// --- Controls (Sin hallazgo comprobado) ---

it('control: generation+index lock and slot allow retry after SAVE_FAILED and retryable pre-charge refusal', async () => {
  const g = createGeneration({
    sessionId: sid, kind: 'image', modelRef, prompt: 'retryable slot',
    settings: { count: 1, advanced: {} }, origin: 'composer', estimate: { usd: 0.1, approximate: false },
  });
  idbHooks.failNextStateSave = true;
  await expect(sendGenerationViaPaidGate({
    g, index: 0, signal: new AbortController().signal,
    send: async () => ({ value: 'never', costUsd: 0.1 }),
  })).rejects.toThrow();

  await expect(sendGenerationViaPaidGate({
    g, index: 0, signal: new AbortController().signal,
    isRetryable: () => true,
    send: async () => { throw new Error('upstream access denied'); },
  })).rejects.toThrow(/upstream access denied/);

  const ok = await sendGenerationViaPaidGate({
    g, index: 0, signal: new AbortController().signal,
    send: async () => ({ value: 'ok', costUsd: 0.1, estimated: false }),
  });
  expect(ok.value).toBe('ok');
  expect(useStore.getState().spentUsd).toBeCloseTo(0.1, 6);
});

it('control: settled ticket compaction across reload preserves receipts and prevents double-counting spend', async () => {
  const g = createGeneration({
    sessionId: sid, kind: 'image', modelRef, prompt: 'settled image',
    settings: { count: 1, advanced: {} }, origin: 'composer', estimate: { usd: 0.1, approximate: false },
  });
  await runGeneration(g.id);
  expect(useStore.getState().spentUsd).toBeCloseTo(0.1, 6);
  expect(useStore.getState().spendLog).toHaveLength(1);

  const saved = snapshotStore();
  simulateReload(null, { sessionId: sid, state: saved });
  await resumeInterrupted();
  settleInterruptedPlans();

  expect(useStore.getState().tickets[`gen:${g.id}`]).toBeUndefined();
  expect(useStore.getState().generations[g.id].sends?.[0]?.status).toBe('done');
  expect(useStore.getState().spentUsd).toBeCloseTo(0.1, 6);
  expect(useStore.getState().spendLog).toHaveLength(1);
});

it('control: Retry charge confirmation blocks unconfirmed resend and lets the user proceed once confirmed (media and LLM)', async () => {
  // Media uncertain: plain retry blocks, confirmed retry sends once and exits cleanly.
  fake.onNext('uncertain media', 'cut-after-accept');
  const g = createGeneration({
    sessionId: sid, kind: 'image', modelRef, prompt: 'uncertain media',
    settings: { count: 1, advanced: {} }, origin: 'composer', estimate: { usd: 0.1, approximate: false },
  });
  await expect(runGeneration(g.id)).rejects.toThrow();
  await retryGeneration(g.id);
  expect(fake.acceptedCount('uncertain media')).toBe(1);
  const assets = await retryGeneration(g.id, undefined, undefined, true);
  expect(assets).toHaveLength(1);
  expect(fake.acceptedCount('uncertain media')).toBe(2);

  // LLM empty/length charged reply: plain retry blocks, confirmed retry sends and recovers.
  useStore.setState((state) => ({ settings: { ...state.settings, budgetOn: false } }));
  fake.onNext('/chat/completions', () =>
    sseResponse([
      { choices: [{ delta: { reasoning_content: 'exhausted' }, finish_reason: 'length' }] },
      { choices: [], usage: { prompt_tokens: 100, completion_tokens: 500, cost: 0.05 } },
    ]),
  );
  await llmTurn(sid, 'chat', { route: 'new', agentNodeId: 'main' });
  const notice = useStore.getState().sessions[sid].feed.find((f) => f.type === 'notice' && f.retry)!;
  await retryAgentTurn(sid, notice.id);
  expect(fake.acceptedCount('/chat/completions')).toBe(1);
  await retryAgentTurn(sid, notice.id, true);
  expect(fake.acceptedCount('/chat/completions')).toBe(2);
});

it('control: in-memory ticket table stays bounded across 25 completed LLM sends without serializing old closed tickets', async () => {
  for (let i = 0; i < 25; i++) {
    await sendLlmViaPaidGate({
      ticketId: `llm:perf-${i}`, sessionId: sid, provider: 'nanogpt', apiKey: 'test-only', model: llmModel,
      system: 'Test', messages: [{ role: 'user', content: `Hi ${i}` }], tools: [],
      signal: new AbortController().signal, budgetPass: true, computeUsd: () => 0.01,
    });
  }
  const remaining = Object.keys(useStore.getState().tickets);
  expect(remaining.length).toBeLessThanOrEqual(16);
  expect(useStore.getState().spentUsd).toBeCloseTo(0.25, 6);
});
