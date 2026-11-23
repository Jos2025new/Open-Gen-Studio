// @vitest-environment jsdom
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// @ts-expect-error The checker is a .mjs script with no declaration.
import { check as rawCheck } from '../scripts/check-paid-send.mjs';
import '../src/engine/commands';
import { createSession, useStore } from '../src/store/store';
import { decideCommandApproval, runCommandsTool } from '../src/engine/agent/commandCalls';
import { retryAgentTurn } from '../src/engine/agent/conversation';
import { llmTurn, settleInterruptedPlans } from '../src/engine/agent/runtime';
import { llmCallUsd } from '../src/engine/agent/runtimeShared';
import { remainingBudget } from '../src/engine/budget';
import { setApprover } from '../src/engine/commands';
import { patchNodeData } from '../src/engine/flow/actions';
import { createGeneration, resumeInterrupted, retryGeneration, runGeneration } from '../src/engine/jobs';
import { reconcileLlmCharge, sendLlmViaPaidGate } from '../src/engine/money/llmSend';
import { paidSend, type TicketAccess } from '../src/engine/money/paidSend';
import { sendGenerationViaPaidGate } from '../src/engine/money/storeBridge';
import { createTicket, exactPrice, type ApprovalTicket } from '../src/engine/money/ticket';
import type { CommandApprovalFeedItem, GenNodeData, ModelSummary, PlanFeedItem } from '../src/engine/types';
import { createFakeProvider, jsonResponse, simulateReload, snapshotStore, sseResponse, type FakeProvider } from './helpers/fakeProvider';

const idb = vi.hoisted(() => ({ onSave: undefined as (() => void) | undefined }));
vi.mock('../src/lib/idb', () => ({
  stateDb: {
    get: async () => null,
    set: async () => { idb.onSave?.(); return { ok: true }; },
    del: async () => undefined,
  },
  cacheDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  getAssetBlob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
}));
vi.mock('../src/lib/media', async (original) => ({
  ...(await original<typeof import('../src/lib/media')>()),
  probeMedia: async () => ({ width: 64, height: 64, size: 3 }),
  blobToDataUrl: async () => 'data:image/png;base64,cG5n',
  jpegThumbnail: async () => undefined,
}));

const check = rawCheck as (root: string) => string[];
const modelRef = 'nanogpt::paid-img';
const llmModel = 'paid-llm';
let sid: string;
let fake: FakeProvider;

beforeEach(() => {
  setApprover(null);
  fake = createFakeProvider();
  fake.install();
  const fresh = createSession('D+ adversarial');
  sid = fresh.id;
  const node: GenNodeData = {
    kind: 'image', title: 'Reviewed', prompt: 'reviewed prompt', modelRef,
    settings: { count: 1, advanced: {} }, outputIndex: 0,
  };
  const model = {
    ref: modelRef, provider: 'nanogpt', id: 'paid-img', name: 'Paid image', kind: 'image',
    acceptsText: true, acceptsImage: true, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] },
  } as unknown as ModelSummary;
  useStore.setState((state) => ({
    activeSessionId: sid,
    sessions: { [sid]: { ...fresh, graph: { nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: node }], edges: [] } } },
    generations: {}, tickets: {}, spendLog: [], spentUsd: 0, quotes: {},
    catalog: {
      ...state.catalog,
      models: { [modelRef]: model },
      schemas: { [modelRef]: { ref: modelRef, params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' } },
      llm: { ...state.catalog.llm, nanogpt: [{ id: llmModel, name: 'Paid LLM', inputPrice: 20, outputPrice: 40, tools: true, vision: false }] as never },
      llmStatus: { openrouter: 'idle', nanogpt: 'ready', atlas: 'idle' },
    },
    settings: {
      ...state.settings,
      keys: { ...state.settings.keys, nanogpt: 'test-only' },
      agent: { ...state.settings.agent, provider: 'nanogpt', model: llmModel, effort: 'none' },
      budgetOn: true, budgetUsd: 1, budgetNoAsk: false, budgetAccepted: null,
    },
  }));
});

afterEach(() => {
  idb.onSave = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function sendLlm(id: string) {
  return sendLlmViaPaidGate({
    ticketId: id, sessionId: sid, provider: 'nanogpt', apiKey: 'test-only', model: llmModel,
    system: 'Test', messages: [{ role: 'user', content: 'Hello' }], tools: [],
    signal: new AbortController().signal, budgetPass: true, computeUsd: (usage) => llmCallUsd('nanogpt', llmModel, usage),
  });
}

function createImage() {
  return createGeneration({
    sessionId: sid, kind: 'image', modelRef, prompt: 'test image', settings: { count: 1, advanced: {} },
    origin: 'composer', estimate: { usd: 0.1, approximate: false },
  });
}

function scanFixture(file: string, content: string): string[] {
  const root = mkdtempSync(join(tmpdir(), 'ogs-dplus-sol-'));
  try {
    const target = join(root, file);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content);
    return check(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

it('rejects a second dispatch for the same logical paid slot', async () => {
  const g = createImage();
  let arrive!: () => void;
  let release!: () => void;
  const arrived = new Promise<void>((done) => { arrive = done; });
  const hold = new Promise<void>((done) => { release = done; });
  const send = vi.fn(async () => {
    arrive();
    await hold;
    return { value: 'accepted', costUsd: 0.1 };
  });
  const opts = { g, index: 0, signal: new AbortController().signal, send };
  const first = sendGenerationViaPaidGate(opts);
  await arrived;
  const second = sendGenerationViaPaidGate(opts);
  release();
  await Promise.allSettled([first, second]);
  expect(send, 'the same logical slot reached transport twice').toHaveBeenCalledTimes(1);
});

it('keeps a media HTTP 500 uncertain and retains its reservation', async () => {
  const g = createImage();
  fake.onNext('test image', () => jsonResponse({ error: 'Gateway lost upstream response' }, 500));
  await expect(runGeneration(g.id)).rejects.toThrow();
  expect(fake.acceptedCount('test image')).toBe(1);
  const slot = useStore.getState().tickets[`gen:${g.id}`].sends[0];
  expect({ status: slot.status, reservedUsd: slot.reservedUsd }).toEqual({ status: 'uncertain', reservedUsd: 0.1 });
});

it('requires charge confirmation before repeating an uncertain LLM turn', async () => {
  fake.onNext('/chat/completions', 'cut-after-accept');
  await llmTurn(sid, 'chat', { route: 'new', agentNodeId: 'main', budgetPass: true });
  expect(fake.acceptedCount('/chat/completions')).toBe(1);
  const ticket = Object.values(useStore.getState().tickets).find((entry) => entry.kind === 'llm');
  expect(ticket?.sends[0]?.status).toBe('uncertain');
  const notice = useStore.getState().sessions[sid].feed.find((item) => item.type === 'notice' && item.retry);
  if (notice) await retryAgentTurn(sid, notice.id);
  expect(fake.acceptedCount('/chat/completions'), 'plain Retry replayed a potentially charged call').toBe(1);
});

it('gives a completed LLM retry a way to reconcile the original reservation', async () => {
  fake.onNext('/chat/completions', 'cut-after-accept');
  await expect(sendLlm('llm:lost')).rejects.toThrow();
  const saved = snapshotStore();
  simulateReload(null, { sessionId: sid, state: saved });
  settleInterruptedPlans();
  expect(fake.acceptedCount('/chat/completions')).toBe(1);
  expect(remainingBudget()).toBeCloseTo(0.96, 6);
  await sendLlm('llm:later');
  expect(fake.acceptedCount('/chat/completions')).toBe(2);
  expect(reconcileLlmCharge(sid, 'llm:lost')).toBe(true);
  expect(useStore.getState().spendLog.filter((entry) => entry.unknownPrice)).toHaveLength(1);
  expect(remainingBudget(), 'the old $0.04 reservation still reduces the usable budget').toBeCloseTo(1 - useStore.getState().spentUsd, 6);
});

it('records a completed billable LLM call with missing usage as unknown', async () => {
  fake.onNext('/chat/completions', () =>
    sseResponse([{ choices: [{ delta: { content: 'Done' }, finish_reason: 'stop' }] }]),
  );
  const sent = await sendLlm('llm:missing-usage');
  expect(fake.acceptedCount('/chat/completions')).toBe(1);
  const slot = useStore.getState().tickets['llm:missing-usage'].sends[0];
  expect({ cost: slot.settledUsd ?? null, bookedUnknown: slot.bookedUnknown ?? false }).toEqual({ cost: null, bookedUnknown: true });
  expect(useStore.getState().spendLog.find((entry) => entry.sendId === sent.sendId)?.usd).toBeNull();
});

it('requires a new review before sending a changed node from a restored command card', async () => {
  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n1'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));
  const card = commandCard();
  const saved = snapshotStore();
  decideCommandApproval(sid, card.id, 'cancel');
  await pending;
  simulateReload(null, { sessionId: sid, state: saved });
  settleInterruptedPlans();
  expect(patchNodeData(sid, 'n1', { prompt: 'different prompt' })).toBeNull();
  expect(decideCommandApproval(sid, card.id, 'approve')).toBe(true);
  expect(decideCommandApproval(sid, card.id, 'approve')).toBe(false);
  await vi.waitFor(() => expect(commandCard().status).not.toBe('running'));
  expect(fake.acceptedCount('different prompt'), 'the restored approval dispatched an unreviewed prompt').toBe(0);
  expect(commandCard().status).toBe('awaiting');
  expect(commandCard().steps[0].details?.join(' ')).toContain('different prompt');
  expect(decideCommandApproval(sid, card.id, 'approve')).toBe(true);
  await vi.waitFor(() => expect(commandCard().status).toBe('done'));
  expect(fake.acceptedCount('different prompt')).toBe(1);
});

it('offers one-click approval for a plan whose next step was still pending', async () => {
  const item: PlanFeedItem = {
    id: 'plan-card', createdAt: 1, type: 'plan', style: 'auto', workspace: 'chat', status: 'running',
    plan: {
      id: 'plan-test', title: 'Pending image', summary: '', workspace: 'chat', style: '', subjects: [], adjustments: [],
      steps: [{ id: 's1', kind: 'image', title: 'Pending', prompt: 'pending image', modelRef, settings: { count: 1, advanced: {} }, refs: [] }],
    },
    stepStates: { s1: 'pending' }, stepGenerations: {}, estimate: { usd: 0.1, approximate: false },
  };
  const ticket = createTicket({ id: 'plan:plan-card', sessionId: sid, kind: 'plan', price: exactPrice(0.1), scope: { steps: ['s1'] } });
  useStore.setState((state) => ({
    sessions: { [sid]: { ...state.sessions[sid], feed: [item] } },
    tickets: { [ticket.id]: ticket },
  }));
  simulateReload(null, { sessionId: sid, state: snapshotStore() });
  await resumeInterrupted();
  settleInterruptedPlans();
  expect(fake.attemptCount()).toBe(0);
  const restored = useStore.getState().sessions[sid].feed[0] as PlanFeedItem;
  expect(restored.status, 'pending work is shown as an error instead of offering approval').toBe('awaiting');
});

it('runs local generation without creating a paid ticket or paid slot', async () => {
  const g = createGeneration({
    sessionId: sid, kind: 'image', modelRef: 'local::test', prompt: 'local image',
    settings: { count: 1, advanced: {} }, origin: 'composer', estimate: { usd: 0, approximate: false },
  });
  const send = vi.fn(async () => ({ value: 'local', costUsd: 0 }));
  await sendGenerationViaPaidGate({ g, index: 0, signal: new AbortController().signal, send });
  expect(send).toHaveBeenCalledOnce();
  expect(useStore.getState().tickets[`gen:${g.id}`]).toBeUndefined();
});

it('keeps terminal ticket history out of the synchronous pre-send serialization', async () => {
  for (let i = 0; i < 8; i++) await sendLlm(`llm:closed-${i}`);
  const getSerializations = vi.fn();
  const prior = useStore.getState().tickets['llm:closed-0'];
  expect(prior?.sends[0]?.status).toBe('done');
  if (prior) Object.defineProperty(prior, 'toJSON', { configurable: true, value: () => { getSerializations(); return { ...prior }; } });
  let historicalVisitsBeforeFetch = -1;
  fake.onPaidRequest = () => { historicalVisitsBeforeFetch = getSerializations.mock.calls.length; };
  try {
    await sendLlm('llm:new');
    expect(historicalVisitsBeforeFetch, 'completed historical tickets were serialized on the caller thread before fetch').toBe(0);
  } finally {
    if (prior) delete (prior as ApprovalTicket & { toJSON?: () => unknown }).toJSON;
  }
});

it('compacts terminal LLM tickets while keeping their settled spend', async () => {
  for (let i = 0; i < 12; i++) await sendLlm(`llm:turn-${i}`);
  simulateReload(null, { sessionId: sid, state: snapshotStore() });
  settleInterruptedPlans();
  expect(useStore.getState().spendLog).toHaveLength(12);
  expect(Object.values(useStore.getState().tickets).filter((ticket) => ticket.kind === 'llm'), 'all 12 finished turns remain as full tickets').toHaveLength(0);
});

it('flags an adapter generate method passed around as a bound function', () => {
  const file = 'src/engine/mediaCaller.ts';
  const diagnostics = scanFixture(file, [
    '',
    "import { nanogpt as adapter } from './providers/nanogpt';",
    'export function send(input: Parameters<typeof adapter.generate>[0]) {',
    '  const generate = adapter.generate.bind(adapter);',
    '  return generate(input);',
    '}',
  ].join('\n'));
  expect(diagnostics.join('\n')).toMatch(/mediaCaller\.ts:[23]:.*paidSend/);
});

it('flags an eager chat call made before paidSend can reserve or persist', () => {
  const file = 'src/engine/money/llmSend.ts';
  const diagnostics = scanFixture(file, [
    "import { paidSend } from './paidSend';",
    '',
    "import { chat } from '../providers/llm';",
    'export const attempt = (input: Parameters<typeof chat>[0]) => paidSend({ prepare: chat(input) } as never);',
  ].join('\n'));
  expect(diagnostics.join('\n')).toMatch(/llmSend\.ts:3:.*paidSend/);
});

it('flags an ungated namespace chat call inside llmSend', () => {
  const file = 'src/engine/money/llmSend.ts';
  const diagnostics = scanFixture(file, [
    '',
    "import * as llm from '../providers/llm';",
    'export const attempt = (input: Parameters<typeof llm.chat>[0]) => llm.chat(input);',
  ].join('\n'));
  expect(diagnostics.join('\n')).toMatch(/llmSend\.ts:2:.*paidSend/);
});

it('does not replay a booked media send when reload precedes local output storage', async () => {
  const image = createImage();
  let saved: unknown;
  idb.onSave = () => {
    const state = useStore.getState();
    const slot = state.tickets[`gen:${image.id}`]?.sends[0];
    const generation = state.generations[image.id];
    if (slot?.status === 'done' && generation.status === 'running' && !generation.assetIds.length) {
      saved ??= snapshotStore();
    }
  };
  await runGeneration(image.id);
  expect(saved, 'durable snapshot between settlement and saving the asset').toBeDefined();
  expect(fake.acceptedCount('test image')).toBe(1);
  simulateReload(null, { sessionId: sid, state: saved });
  await resumeInterrupted();
  expect(fake.acceptedCount('test image')).toBe(1);
  await retryGeneration(image.id);
  expect(fake.acceptedCount('test image'), 'ordinary Retry posted again after durable settlement').toBe(1);
});

it('does not treat a nominal LLM estimate as a guaranteed ceiling under the active limit', async () => {
  useStore.setState((state) => ({ settings: { ...state.settings, budgetUsd: 0.05 } }));
  fake.onNext('/chat/completions', () =>
    sseResponse([
      { choices: [{ delta: { content: 'Long answer' }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 4000 } },
    ]),
  );
  await llmTurn(sid, 'chat', { route: 'new', agentNodeId: 'main' });
  expect(fake.acceptedCount('/chat/completions'), `unconfirmed send booked $${useStore.getState().spentUsd} against $0.05`).toBe(0);
});

it('records a command approval and its paid node send on one ticket', async () => {
  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n1'], force: true } }] });
  const card = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands');
  await vi.waitFor(() => expect(card()?.status).toBe('awaiting'));
  expect(decideCommandApproval(sid, card()!.id, 'approve')).toBe(true);
  await pending;
  expect(fake.acceptedCount('reviewed prompt')).toBe(1);
  expect(Object.values(useStore.getState().tickets).map((ticket) => ticket.kind)).toEqual(['commands']);
  const ticket = useStore.getState().tickets[`cmd:${card()!.id}`];
  expect(ticket.sends.filter((slot) => slot.generationId)).toMatchObject([{ status: 'done', bookedUsd: 0.1 }]);
});

it('applies a graph edit while the provider response is held', async () => {
  const held = fake.holdNext('/chat/completions');
  const sending = sendLlm('llm:editing');
  await held.arrived;
  try {
    expect(patchNodeData(sid, 'n1', { prompt: 'edited independently' })).toBeNull();
    expect(useStore.getState().sessions[sid].graph.nodes[0].data).toMatchObject({ prompt: 'edited independently' });
  } finally {
    held.resolve();
    await sending;
  }
});

it('blocks unknown or minimum-only prices, and blocks a double click on the same actual sendId', async () => {
  const price = exactPrice(0.1);
  const ticket = createTicket({ id: 'control', sessionId: sid, kind: 'generation', price });
  const byId = new Map([[ticket.id, ticket]]);
  const tickets: TicketAccess = { get: (id) => byId.get(id), list: () => [...byId.values()], put: (entry) => { byId.set(entry.id, entry); } };
  const send = vi.fn(async () => ({ value: 'accepted', costUsd: 0.1 }));
  const book = vi.fn();
  const base = {
    ticketId: ticket.id, tickets, send, onBookSpend: book, save: async () => undefined,
    getBudget: () => ({ budgetOn: true, budgetUsd: 1, spentUsd: 0 }),
  };
  for (const unbounded of [
    { kind: 'unknown' as const, usd: null, maxVerifiableUsd: null },
    { kind: 'estimated' as const, usd: 0.01, maxVerifiableUsd: null, lowerBound: true },
  ]) {
    await expect(paidSend({ ...base, prepare: { id: unbounded.kind, slotKey: unbounded.kind, price: unbounded } })).rejects.toMatchObject({ code: 'UNKNOWN_PRICE' });
  }
  expect(send).not.toHaveBeenCalled();
  const same = { ...base, prepare: { id: 'same', slotKey: 'same', price } };
  const first = paidSend(same);
  await expect(paidSend(same)).rejects.toMatchObject({ code: 'ALREADY_SENT' });
  await first;
  await expect(paidSend(same)).rejects.toMatchObject({ code: 'ALREADY_SENT' });
  expect(send).toHaveBeenCalledOnce();
  expect(book).toHaveBeenCalledOnce();
});
