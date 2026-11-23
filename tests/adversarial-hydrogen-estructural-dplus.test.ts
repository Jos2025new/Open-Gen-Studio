// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import '../src/engine/commands';
import { createSession, useStore } from '../src/store/store';
import { useAlerts } from '../src/engine/alerts';
import { saveAssetEdit } from '../src/engine/assetRevisions';
import { decideCommandApproval, runCommandsTool } from '../src/engine/agent/commandCalls';
import { approvePlan } from '../src/engine/agent/planRun';
import { withOncePass } from '../src/engine/budget';
import { setApprover } from '../src/engine/commands';
import { previewRun } from '../src/engine/flow/actions';
import { resetSendLocks, paidSend } from '../src/engine/money/paidSend';
import { budgetSnapshotFor, storeTickets } from '../src/engine/money/storeBridge';
import { exactPrice } from '../src/engine/money/ticket';
import { resetActions } from '../src/engine/nodecore/action';
import { openrouter } from '../src/engine/providers/openrouter';
import { resolveSendPlan, sendFingerprint } from '../src/engine/sendInputs';
import type {
  CommandApprovalFeedItem,
  GenNodeData,
  ModelSchema,
  ModelSummary,
  PlanFeedItem,
  ToolNodeData,
} from '../src/engine/types';
import { createFakeProvider, jsonResponse, type FakeProvider } from './helpers/fakeProvider';

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
  probeMedia: async () => ({ width: 64, height: 64, size: 3, duration: 10 }),
  prepareImageForUpload: async (b: Blob) => b,
  blobToDataUrl: async (b: Blob) => `data:image/png;base64,${btoa(String.fromCharCode(...new Uint8Array(await b.arrayBuffer())))}`,
  jpegThumbnail: async () => undefined,
}));

const paidRef = 'nanogpt::paid-img';
const unpricedRef = 'nanogpt::unpriced-img';
const atlasPricedRef = 'atlas::priced-img';
const atlasSameRef = 'atlas::paid-img';
const atlasAudioRef = 'atlas::minimax-music';
const nanoAudioRef = 'nanogpt::whisper-1';

let sid: string;
let sid2: string;
let fake: FakeProvider;

function installModels(defaultImageCost = 0.1) {
  fake = createFakeProvider({ defaultImageCost });
  fake.install();

  const fresh = createSession('D+ Hydrogen structural reattack');
  const other = createSession('D+ Hydrogen other session');
  sid = fresh.id;
  sid2 = other.id;

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
  const atlasSameModel = {
    ref: atlasSameRef, provider: 'atlas', id: 'paid-img', name: 'Paid image', kind: 'image',
    acceptsText: true, acceptsImage: true, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] },
  } as unknown as ModelSummary;
  const atlasAudioModel = {
    ref: atlasAudioRef, provider: 'atlas', id: 'minimax-music', name: 'MiniMax Music', kind: 'audio',
    acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] },
  } as unknown as ModelSummary;

  const paidSchema: ModelSchema = {
    ref: paidRef,
    params: [{ key: 'n', label: 'Count', role: 'count', type: 'integer', min: 1, max: 1, default: 1 }],
    source: 'catalog',
    slots: { prompt: 'prompt', promptRequired: true, images: { key: 'imageDataUrls', min: 0, max: 4, multiple: true, format: 'data-url' } },
  };
  const audioSchema: ModelSchema = {
    ref: atlasAudioRef,
    params: [
      { key: 'lyrics', label: 'Lyrics', role: 'other', type: 'text', multiline: true },
    ],
    source: 'catalog',
    slots: { prompt: 'prompt', promptRequired: true },
  };

  useStore.setState((state) => ({
    activeSessionId: sid,
    sessions: {
      [sid]: {
        ...fresh,
        graph: {
          nodes: [
            { id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'Node 1', prompt: 'node one prompt', modelRef: paidRef, settings: { count: 1, advanced: {} }, outputIndex: 0 } },
            { id: 'n2', position: { x: 200, y: 0 }, data: { kind: 'image', title: 'Node 2', prompt: 'node two prompt', modelRef: unpricedRef, settings: { count: 1, advanced: {} }, outputIndex: 0 } },
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
        [atlasSameRef]: atlasSameModel,
        [atlasAudioRef]: atlasAudioModel,
      },
      schemas: {
        [paidRef]: paidSchema,
        [unpricedRef]: { ref: unpricedRef, params: [], source: 'catalog', slots: { prompt: 'prompt', promptRequired: true } },
        [atlasPricedRef]: { ref: atlasPricedRef, params: [], source: 'catalog', slots: { prompt: 'prompt', promptRequired: true } },
        [atlasSameRef]: { ...paidSchema, ref: atlasSameRef },
        [atlasAudioRef]: audioSchema,
        [nanoAudioRef]: { ref: nanoAudioRef, params: [], source: 'catalog', slots: {} },
      },
      transcribers: {
        [nanoAudioRef]: { ref: nanoAudioRef, provider: 'nanogpt', id: 'whisper-1', name: 'Whisper', usdPerMinute: 0.01, maxDirectBytes: 3 * 1024 * 1024, video: false, diarization: false },
      },
      llm: {
        ...state.catalog.llm,
        openrouter: [
          { id: 'paid-llm', name: 'Paid LLM', inputPrice: 1, outputPrice: 2, contextLength: 8192, tools: true, vision: false, reasoning: false },
        ],
      },
    },
    settings: {
      ...state.settings,
      keys: { ...state.settings.keys, nanogpt: 'test-only', atlas: 'test-only', fal: 'test-only', openrouter: 'test-only' },
      ops: { ...state.settings.ops, edit: paidRef, transcribe: nanoAudioRef },
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

// ============================================================================
// FINDINGS
// ============================================================================

it('H1a: nodes.run.start on a transcribe tool node must not deadlock in COMMAND_REVIEW_CHANGED', async () => {
  blobs.set('ast_audio', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/mpeg' }));
  let transcribeCalls = 0;
  const origFetch = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/transcribe')) {
      transcribeCalls++;
      return jsonResponse({ transcription: 'hello world', metadata: { cost: 0.01 } }, 200);
    }
    return origFetch(input, init);
  }));

  const toolData: ToolNodeData = {
    kind: 'tool', title: 'Transcribe', op: 'transcribe',
    params: { language: 'en' }, outputIndex: 0,
  };
  useStore.setState((state) => ({
    assets: {
      ...state.assets,
      ast_audio: { id: 'ast_audio', kind: 'audio', mime: 'audio/mpeg', width: 0, height: 0, duration: 30, sessionId: sid, origin: 'upload', stored: true, favorite: false, createdAt: 1 },
    },
    sessions: {
      ...state.sessions,
      [sid]: {
        ...state.sessions[sid],
        graph: {
          nodes: [
            { id: 'n_aud', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Audio', assetId: 'ast_audio' } },
            { id: 'n_tr', position: { x: 200, y: 0 }, data: toolData },
          ],
          edges: [{ id: 'e_in', source: 'n_aud', target: 'n_tr', sourceHandle: 'out', targetHandle: 'input' }],
        },
      },
    },
  }));

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n_tr'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));

  expect(decideCommandApproval(sid, commandCard().id, 'once')).toBe(true);
  const res = await pending;
  const gen = Object.values(useStore.getState().generations)[0];
  expect(gen).toBeDefined();
  expect(gen?.error).toBeUndefined();
  expect(res).toMatchObject({ done: true });
  expect(transcribeCalls).toBe(1);
});

it('H1b: nodes.run.start on an audio node with lyrics wired from a text node must not deadlock in COMMAND_REVIEW_CHANGED', async () => {
  const audioData: GenNodeData = {
    kind: 'audio', title: 'Song', prompt: 'indie pop', modelRef: atlasAudioRef,
    settings: { count: 1, advanced: {} }, outputIndex: 0,
  };
  useStore.setState((state) => ({
    sessions: {
      ...state.sessions,
      [sid]: {
        ...state.sessions[sid],
        graph: {
          nodes: [
            { id: 'n_txt', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'Lyrics', text: '# My Song\nStyle: pop\n\nLa la la' } },
            { id: 'n_aud', position: { x: 200, y: 0 }, data: audioData },
          ],
          edges: [{ id: 'e_lyr', source: 'n_txt', target: 'n_aud', sourceHandle: 'out', targetHandle: 'lyrics' }],
        },
      },
    },
  }));

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n_aud'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));

  expect(decideCommandApproval(sid, commandCard().id, 'approve')).toBe(true);
  await pending;

  const gen = Object.values(useStore.getState().generations)[0];
  expect(gen?.error).toBeUndefined();
  expect(fake.acceptedCount('indie pop')).toBe(1);
});

it('H1c: studio.generate.start blocks transport when an attached image is edited in-place between review and transport', async () => {
  blobs.set('ast_ref', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }));
  const origFetch = globalThis.fetch;
  let editedDuringQuote = false;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/v1/model/calculate') && !editedDuringQuote) {
      editedDuringQuote = true;
      await saveAssetEdit('ast_ref', new Blob([new Uint8Array([9, 9, 9, 9])], { type: 'image/png' }), 'original');
    }
    return origFetch(input, init);
  }));

  useStore.setState((state) => ({
    assets: {
      ...state.assets,
      ast_ref: { id: 'ast_ref', kind: 'image', mime: 'image/png', width: 64, height: 64, sessionId: sid, origin: 'upload', stored: true, favorite: false, createdAt: 1 },
    },
    composer: {
      ...state.composer,
      mode: 'image',
      text: 'studio direct edited ref',
      attachments: ['ast_ref'],
      image: { ...state.composer.image, modelRef: atlasSameRef, settings: { count: 1, advanced: {} } },
    },
  }));

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'studio.generate.start', args: { kind: 'image' } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));

  expect(decideCommandApproval(sid, commandCard().id, 'approve')).toBe(true);
  await pending;

  await vi.waitFor(() => {
    const g = Object.values(useStore.getState().generations)[0];
    expect(g && (g.status === 'done' || g.status === 'error')).toBe(true);
  });

  expect(editedDuringQuote).toBe(true);
  expect(fake.acceptedCount('studio direct edited ref'), 'studio.generate.start dispatched edited asset bytes without fingerprint verification before transport').toBe(0);
});

it('H1d: sendFingerprint covers OpenRouter passthrough options (settings.extras) sent in provider.options', async () => {
  const orRef = 'openrouter::acme/or-img';
  const origFetch = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/v1/images/models')) {
      return jsonResponse({
        data: [{
          id: 'acme/or-img',
          name: 'OR Img',
          architecture: { input_modalities: ['text'], output_modalities: ['image'] },
          supported_parameters: { aspect_ratio: { type: 'enum', values: ['1:1'] } },
        }],
      });
    }
    if (url.endsWith('/api/v1/images/models/acme/or-img/endpoints')) {
      return jsonResponse({
        endpoints: [{
          provider_slug: 'recraft',
          supported_parameters: { aspect_ratio: { type: 'enum', values: ['1:1'] } },
          allowed_passthrough_parameters: ['controls'],
          pricing: [{ billable: 'output', unit: 'image', cost_usd: 0.05 }],
        }],
      });
    }
    if (url.endsWith('/api/v1/videos/models')) return jsonResponse({ data: [] });
    return origFetch(input, init);
  }));

  const orModel = {
    ref: orRef, provider: 'openrouter', id: 'acme/or-img', name: 'OR Img', kind: 'image',
    acceptsText: true, acceptsImage: false, tags: [],
  } as unknown as ModelSummary;
  const schema = await openrouter.loadSchema!(orModel, 'test-only');
  useStore.setState((state) => ({
    catalog: {
      ...state.catalog,
      models: { ...state.catalog.models, [orRef]: orModel },
      schemas: { ...state.catalog.schemas, [orRef]: schema },
    },
  }));

  const st = useStore.getState();
  const fpA = sendFingerprint(resolveSendPlan({
    kind: 'image', modelRef: orRef, prompt: 'or passthrough',
    settings: { count: 1, advanced: {}, extras: { controls: { colors: [{ rgb: [0, 0, 0] }] } } },
    inputs: { refs: [] },
  }, st), st);
  const fpB = sendFingerprint(resolveSendPlan({
    kind: 'image', modelRef: orRef, prompt: 'or passthrough',
    settings: { count: 1, advanced: {}, extras: { controls: { colors: [{ rgb: [255, 0, 0] }] } } },
    inputs: { refs: [] },
  }, st), st);

  expect(fpA).not.toBe(fpB);
});

it('H2a: 402 provider switch on a node_run (nr:...) approved with Continue once is not deadlocked by closed ticket', async () => {
  useStore.setState((state) => ({
    settings: { ...state.settings, budgetOn: true, budgetUsd: 0.05, autoSwitchProvider: 'ask' },
  }));
  fake.onNext('node one prompt', 'http-402');

  const preview = previewRun(sid, ['n1'], true);
  const planItem: PlanFeedItem = {
    id: 'pln-node-run-402', createdAt: 1, type: 'plan', style: 'auto', workspace: 'node', status: 'awaiting',
    nodeRun: { targets: ['n1'], force: true, signature: preview.signature, runIds: preview.runIds },
    plan: {
      id: 'pln-nr-402', title: 'Run node', summary: '', workspace: 'node',
      steps: preview.steps, adjustments: [],
    },
    stepStates: {}, stepGenerations: {}, estimate: preview.estimate,
  };

  useStore.setState((state) => ({
    sessions: { ...state.sessions, [sid]: { ...state.sessions[sid], feed: [planItem] } },
  }));

  await withOncePass(sid, (pass) => approvePlan(sid, planItem.id, pass), 0.1, false);

  const alert = useAlerts.getState().alerts.find((a) => a.actions?.some((act) => act.label === 'Yes, this time'));
  expect(alert).toBeDefined();
  const yesAction = alert!.actions!.find((act) => act.label === 'Yes, this time')!;
  yesAction.run();

  await vi.waitFor(() => expect(fake.acceptedCount('node one prompt')).toBe(1), { timeout: 2000 });
});

it('H2b: once command ticket with lower actual cost cannot authorize extra sends on that step after done', async () => {
  useStore.setState((state) => ({ settings: { ...state.settings, budgetOn: true, budgetUsd: 0.05 } }));
  fake.onNext('node one prompt', async () => jsonResponse({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }], cost: 0.02 }, 200));

  const pending = runCommandsTool(sid, {
    seq: [{ cmd: 'nodes.run.start', args: { targets: ['n1'], force: true } }],
  });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));
  const card = commandCard();

  expect(decideCommandApproval(sid, card.id, 'once')).toBe(true);
  await pending;
  expect(commandCard().status).toBe('done');

  const ticketId = `cmd:${card.id}`;
  await expect(
    paidSend({
      ticketId,
      prepare: { id: 'snd_extra_same_step', slotKey: 'extra:step', stepKey: 'cmd:1:node:n1', price: exactPrice(0.08) },
      tickets: storeTickets,
      getBudget: () => budgetSnapshotFor(sid),
      save: async () => undefined,
      onBookSpend: () => undefined,
      send: async () => ({ value: 'extra', costUsd: 0.08 }),
    }),
  ).rejects.toMatchObject({ name: 'PaidSendBlockedError' });
});
