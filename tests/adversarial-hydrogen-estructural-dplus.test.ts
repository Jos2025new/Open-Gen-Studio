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
import { previewRun } from '../src/engine/flow/actions';
import { resetSendLocks, paidSend } from '../src/engine/money/paidSend';
import { budgetSnapshotFor, storeTickets } from '../src/engine/money/storeBridge';
import { exactPrice } from '../src/engine/money/ticket';
import { sendLlmViaPaidGate } from '../src/engine/money/transport';
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
          { id: 'paid-llm', name: 'Paid LLM', inputPrice: 1, outputPrice: 2, contextLength: 8192, supportsTools: true, supportsVision: false, supportsReasoning: false },
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

// reproduce: describeStepsSend (sendInputs.ts:181-183) freezes concreteFingerprints for op:'transcribe' with modelRef:'transcribe' and prompt:'Transcribe', whereas opSpec (opSpec.ts:116-122) sets modelRef:t.ref and prompt:'Transcribe (<lang>)'; runSpecialSend (specialSends.ts:25) always throws COMMAND_REVIEW_CHANGED.
it.fails('H1a: nodes.run.start on a transcribe tool node must not deadlock in COMMAND_REVIEW_CHANGED', async () => {
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
      ast_audio: { id: 'ast_audio', kind: 'audio', mime: 'audio/mpeg', duration: 30, sessionId: sid, origin: 'upload', stored: true, favorite: false, createdAt: 1 },
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

// reproduce: describeStepsSend (sendInputs.ts:190-192) resolves textOf(s.lyricsFrom) into settings.extras.__lyricsFrom (dropped by wireParams in sendFingerprint), while runAudio (planSteps/exec/audio.ts:16-18) writes settings.extras[lyricsParamKey], causing jobs.ts:263 beforeTransport to always throw COMMAND_REVIEW_CHANGED.
it.fails('H1b: nodes.run.start on an audio node with lyrics wired from a text node must not deadlock in COMMAND_REVIEW_CHANGED', async () => {
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

// reproduce: actions.commands.ts:235-297 and library.commands.ts:32-33 compute review with sendFingerprint, but generateDirect/regenerate/runAssetOp/runLayerOp/createRecraftStyle/createSubjectVoice never pass approvedFingerprint to createGeneration (nor lockAssets), so in-place asset edits before transport bypass jobs.ts:263 / specialSends.ts:25.
it.fails('H1c: studio.generate.start blocks transport when an attached image is edited in-place between review and transport', async () => {
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

// reproduce: sendFingerprint (sendInputs.ts:157) only hashes wireParams(schema, source, count) when schema exists, omitting settings.extras/advanced keys outside schema.params that OpenRouter sends via passthroughSettings -> provider.options (openrouter.ts:313,348-352).
it.fails('H1d: sendFingerprint covers OpenRouter passthrough options (settings.extras) sent in provider.options', async () => {
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
  const schema = await openrouter.loadSchema!(orModel);
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

// reproduce: runNodes finally (flow/actions.ts:342-346) sets closed:true on nr:... tickets immediately upon 402 error; grantGenerationTicketPass -> grantTicketPass (storeBridge.ts:157-171) preserves closed:true, so clicking "Yes, this time" (credit.ts:264) is always blocked with PASS_EXCEEDED in evaluateBudgetGate (paidSend.ts:50).
it.fails('H2a: 402 provider switch on a node_run (nr:...) approved with Continue once is not deadlocked by closed ticket', async () => {
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

// reproduce: finishCommandCard (commandCalls.ts:134) and executePlanItem (planRun.ts:229) never clear ticket.pass or close cmd:/plan: tickets on completion; if actual cost < cap (or with same generationId on a null-cap step), the spent once pass still authorizes extra sends on that stepKey after status==='done'.
it.fails('H2b: once command ticket with lower actual cost cannot authorize extra sends on that step after done', async () => {
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

// ============================================================================
// CONTROLS ("Sin hallazgo (comprobado)")
// ============================================================================

it('control: nodes.run.start re-checks approvedFingerprint on beforeTransport during async requestQuote (blocks edited asset)', async () => {
  blobs.set('ast_src', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }));
  blobs.set('ast_mask', new Blob([new Uint8Array([5, 5, 5, 5])], { type: 'image/png' }));
  const origFetch = globalThis.fetch;
  let editedDuringQuote = false;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/v1/model/calculate') && !editedDuringQuote) {
      editedDuringQuote = true;
      await saveAssetEdit('ast_mask', new Blob([new Uint8Array([9, 9, 9, 9])], { type: 'image/png' }), 'original');
    }
    return origFetch(input, init);
  }));

  const atlasInpaintRef = 'atlas::inpaint-img';
  const atlasInpaintModel = {
    ref: atlasInpaintRef, provider: 'atlas', id: 'inpaint-img', name: 'Atlas inpaint', kind: 'image',
    acceptsText: true, acceptsImage: true, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] },
  } as unknown as ModelSummary;
  useStore.setState((state) => ({
    assets: {
      ...state.assets,
      ast_src: { id: 'ast_src', kind: 'image', mime: 'image/png', width: 64, height: 64, sessionId: sid, origin: 'upload', stored: true, favorite: false, createdAt: 1 },
      ast_mask: { id: 'ast_mask', kind: 'image', mime: 'image/png', width: 64, height: 64, sessionId: sid, origin: 'mask', stored: true, favorite: false, createdAt: 1 },
    },
    catalog: {
      ...state.catalog,
      models: { ...state.catalog.models, [atlasInpaintRef]: atlasInpaintModel },
      schemas: {
        ...state.catalog.schemas,
        [atlasInpaintRef]: {
          ref: atlasInpaintRef, params: [], source: 'catalog',
          slots: { prompt: 'prompt', promptRequired: true, images: { key: 'image', min: 0, max: 1, multiple: false, format: 'url' }, mask: { key: 'mask_image', required: true, convention: 'white', format: 'url' } },
        },
      },
    },
    settings: { ...state.settings, ops: { ...state.settings.ops, editRegion: atlasInpaintRef } },
    sessions: {
      ...state.sessions,
      [sid]: {
        ...state.sessions[sid],
        graph: {
          nodes: [
            { id: 'n_src', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Source', assetId: 'ast_src' } },
            { id: 'n_inp', position: { x: 200, y: 0 }, data: { kind: 'tool', title: 'Edit region', op: 'edit_region', params: { mask: 'ast_mask', instruction: 'inpaint quote race' }, outputIndex: 0 } },
          ],
          edges: [{ id: 'e_in', source: 'n_src', target: 'n_inp', sourceHandle: 'out', targetHandle: 'input' }],
        },
      },
    },
  }));

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n_inp'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));

  expect(decideCommandApproval(sid, commandCard().id, 'approve')).toBe(true);
  await pending;

  expect(editedDuringQuote).toBe(true);
  expect(fake.acceptedCount('inpaint quote race')).toBe(0);
  const gen = Object.values(useStore.getState().generations)[0];
  expect(gen?.error).toBe(COMMAND_REVIEW_CHANGED);
});

it('control: batches (count=2, perRequest=1) re-check approvedFingerprint before item 2 and block after in-place asset edit', async () => {
  blobs.set('ast_ref', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }));
  const hold = fake.holdNext('batch two items');

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
            { id: 'n_batch', position: { x: 200, y: 0 }, data: { kind: 'image', title: 'Batch', prompt: 'batch two items', modelRef: paidRef, settings: { count: 2, advanced: {} }, outputIndex: 0 } },
          ],
          edges: [{ id: 'e_ref', source: 'n_ref', target: 'n_batch', sourceHandle: 'out', targetHandle: 'ref' }],
        },
      },
    },
  }));

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n_batch'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));

  expect(decideCommandApproval(sid, commandCard().id, 'approve')).toBe(true);
  await hold.arrived;
  expect(await saveAssetEdit('ast_ref', new Blob([new Uint8Array([9, 9, 9, 9])], { type: 'image/png' }), 'original')).not.toBeNull();
  hold.resolve();
  await pending;

  expect(fake.acceptedCount('batch two items')).toBe(1);
  const gen = Object.values(useStore.getState().generations)[0];
  expect(gen?.error).toBe(COMMAND_REVIEW_CHANGED);
});

it('control: internal provider retry (Atlas upstream access denied) re-checks approvedFingerprint before retry transport', async () => {
  blobs.set('ast_ref', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }));
  fake.onNext('atlas retry fp', 'atlas-upstream-denied');
  let savePromise: Promise<unknown> | undefined;
  fake.onPaidRequest = (req) => {
    if (req.key.includes('atlas retry fp') && !savePromise) {
      savePromise = saveAssetEdit('ast_ref', new Blob([new Uint8Array([8, 8, 8, 8])], { type: 'image/png' }), 'original');
    }
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
            { id: 'n_atlas', position: { x: 200, y: 0 }, data: { kind: 'image', title: 'Atlas Retry', prompt: 'atlas retry fp', modelRef: atlasSameRef, settings: { count: 1, advanced: {} }, outputIndex: 0 } },
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
  await pending;

  expect(fake.attemptCount('atlas retry fp')).toBe(1);
  expect(fake.acceptedCount('atlas retry fp')).toBe(0);
}, 10000);

it('control: create_voice special send matches approvedFingerprint when audio asset is unchanged', async () => {
  blobs.set('ast_voice', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/mpeg' }));
  const origFetch = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('kling-video/create-voice')) return jsonResponse({ request_id: 'fal_voice_1' });
    if (url.includes('/requests/fal_voice_1/status')) return jsonResponse({ status: 'COMPLETED' });
    if (url.includes('/requests/fal_voice_1')) return jsonResponse({ voice_id: 'voice_123' });
    return origFetch(input, init);
  }));

  useStore.setState((state) => ({
    assets: {
      ...state.assets,
      ast_voice: { id: 'ast_voice', kind: 'audio', mime: 'audio/mpeg', duration: 10, sessionId: sid, origin: 'upload', stored: true, favorite: false, createdAt: 1 },
    },
    sessions: {
      ...state.sessions,
      [sid]: {
        ...state.sessions[sid],
        graph: {
          nodes: [
            { id: 'n_aud', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Voice', assetId: 'ast_voice' } },
            { id: 'n_vc', position: { x: 200, y: 0 }, data: { kind: 'tool', title: 'Create Kling voice', op: 'create_voice', params: {}, outputIndex: 0 } },
          ],
          edges: [{ id: 'e_in', source: 'n_aud', target: 'n_vc', sourceHandle: 'out', targetHandle: 'input' }],
        },
      },
    },
  }));

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n_vc'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));

  expect(decideCommandApproval(sid, commandCard().id, 'once')).toBe(true);
  await pending;

  const gen = Object.values(useStore.getState().generations)[0];
  expect(gen?.status).toBe('done');
  expect(gen?.text).toBe('voice_123');
});

it('control: sendLlmViaPaidGate grants once per sendId and blocks a second unapproved LLM call on the same ticket', async () => {
  useStore.setState((state) => ({ settings: { ...state.settings, budgetOn: true, budgetUsd: 0.0001 } }));

  const first = await sendLlmViaPaidGate({
    ticketId: 'llm:turn-1',
    sessionId: sid,
    provider: 'openrouter',
    apiKey: 'test-only',
    model: 'paid-llm',
    system: 'sys',
    messages: [{ role: 'user', content: 'hi' }],
    tools: [],
    signal: new AbortController().signal,
    budgetPass: true,
    computeUsd: () => 0.01,
  });
  expect(first.value.text).toBe('Done.');

  await expect(
    sendLlmViaPaidGate({
      ticketId: 'llm:turn-1',
      sessionId: sid,
      provider: 'openrouter',
      apiKey: 'test-only',
      model: 'paid-llm',
      system: 'sys',
      messages: [{ role: 'user', content: 'second' }],
      tools: [],
      signal: new AbortController().signal,
      budgetPass: false,
      computeUsd: () => 0.01,
    }),
  ).rejects.toThrow();
  expect(fake.acceptedCount('llm:paid-llm')).toBe(1);
});

it('control: 402 autoSwitch=always on cmd ticket switches to same-price provider', async () => {
  useStore.setState((state) => ({
    settings: { ...state.settings, budgetOn: true, budgetUsd: 0.05, autoSwitchProvider: 'always' },
  }));
  fake.onNext('node one prompt', 'http-402');

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n1'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));

  expect(decideCommandApproval(sid, commandCard().id, 'once')).toBe(true);
  await pending;

  expect(commandCard().status).toBe('done');
  expect(fake.acceptedCount('node one prompt')).toBe(1);
});

it('control: resumePlan(retry) with Continue once retries only failed step and blocks if quote exceeds step cap', async () => {
  installModels(5.0);
  useStore.setState((state) => ({
    settings: { ...state.settings, budgetOn: true, budgetUsd: 0.05 },
  }));

  const planItem: PlanFeedItem = {
    id: 'plan-retry-cap', createdAt: 1, type: 'plan', style: 'auto', workspace: 'chat', status: 'partial',
    plan: {
      id: 'pln-retry-cap', title: 'Retry Cap', summary: '', workspace: 'chat', style: '', subjects: [], adjustments: [],
      steps: [
        { id: 's1', kind: 'image', title: 'Step 1', prompt: 'done step one', modelRef: paidRef, settings: { count: 1, advanced: {} }, refs: [] },
        { id: 's2', kind: 'image', title: 'Step 2', prompt: 'failed step atlas', modelRef: atlasPricedRef, settings: { count: 1, advanced: {} }, refs: [] },
      ],
    },
    stepStates: { s1: 'done', s2: 'error' },
    stepGenerations: { s1: 'g_done', s2: 'g_fail' },
    stepAuthorizations: {
      s1: { modelRef: paidRef, parameters: { count: 1, advanced: {} }, estimate: { usd: 0.1, approximate: false } },
      s2: { modelRef: atlasPricedRef, parameters: { count: 1, advanced: {} }, estimate: { usd: 0.1, approximate: false } },
    },
    estimate: { usd: 0.2, approximate: false },
  };
  useStore.setState((state) => ({
    generations: {
      g_done: {
        id: 'g_done', sessionId: sid, kind: 'image', prompt: 'done step one', modelRef: paidRef, modelName: 'Paid image',
        provider: 'nanogpt', settings: { count: 1, advanced: {} }, inputs: { refs: [] }, origin: 'agent', planId: 'pln-retry-cap', stepId: 's1',
        status: 'done', assetIds: ['ast_1'], estimate: { usd: 0.1, approximate: false }, approvalTicketId: 'plan:plan-retry-cap', createdAt: 1,
      },
      g_fail: {
        id: 'g_fail', sessionId: sid, kind: 'image', prompt: 'failed step atlas', modelRef: atlasPricedRef, modelName: 'Atlas priced',
        provider: 'atlas', settings: { count: 1, advanced: {} }, inputs: { refs: [] }, origin: 'agent', planId: 'pln-retry-cap', stepId: 's2',
        status: 'error', assetIds: [], estimate: { usd: 0.1, approximate: false }, approvalTicketId: 'plan:plan-retry-cap', createdAt: 2,
      },
    },
    tickets: {
      'plan:plan-retry-cap': {
        id: 'plan:plan-retry-cap', sessionId: sid, kind: 'plan', createdAt: 1,
        scope: { steps: ['s1', 's2'] }, price: exactPrice(0.2),
        pass: { kind: 'once', maxUsd: 0.2, steps: { s1: 0.1, s2: 0.1 } },
        sends: [{ id: 'snd_1', slotKey: 'g_done:0', stepKey: 's1', index: 0, status: 'done', price: exactPrice(0.1), reservedUsd: 0, generationId: 'g_done', booked: true, bookedUsd: 0.1, updatedAt: 1 }],
      },
    },
    sessions: { ...state.sessions, [sid]: { ...state.sessions[sid], feed: [planItem] } },
  }));

  await withOncePass(sid, (pass) => resumePlan(sid, planItem.id, 'retry', true, pass), 0.1, false);

  expect(fake.acceptedCount('done step one')).toBe(0);
  expect(fake.acceptedCount('failed step atlas')).toBe(0);
});

it('control: studio.generate.start approved with once blocks when live quote jumps above cmd:1 cap', async () => {
  installModels(5.0);
  useStore.setState((state) => ({
    settings: { ...state.settings, budgetOn: true, budgetUsd: 0.05 },
    composer: {
      ...state.composer,
      mode: 'image',
      text: 'studio quote jump',
      attachments: [],
      image: { ...state.composer.image, modelRef: atlasPricedRef, settings: { count: 1, advanced: {} } },
    },
  }));

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'studio.generate.start', args: { kind: 'image' } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));

  expect(decideCommandApproval(sid, commandCard().id, 'once')).toBe(true);
  await pending;

  await vi.waitFor(() => {
    const g = Object.values(useStore.getState().generations)[0];
    expect(g && (g.status === 'done' || g.status === 'error')).toBe(true);
  });
  expect(fake.acceptedCount('studio quote jump')).toBe(0);
});
