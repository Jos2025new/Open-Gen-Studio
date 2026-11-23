// @vitest-environment jsdom
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// @ts-expect-error The checker is a .mjs script with no declaration.
import { check as rawCheck } from '../scripts/check-paid-send.mjs';
import '../src/engine/commands';
import { setComposer, setComposerMedia, useStore, createSession } from '../src/store/store';
import { useAlerts } from '../src/engine/alerts';
import { saveAssetEdit } from '../src/engine/assetRevisions';
import { decideCommandApproval, runCommandsTool } from '../src/engine/agent/commandCalls';
import { retryAgentTurn } from '../src/engine/agent/conversation';
import { llmTurn, resolveStepCostReview, settleInterruptedPlans } from '../src/engine/agent/runtime';
import { rewritePrompts } from '../src/engine/agent/planSettings';
import { remainingBudget, withOncePass } from '../src/engine/budget';
import { setApprover } from '../src/engine/commands';
import { patchNodeData } from '../src/engine/flow/actions';
import { createGeneration, resumeInterrupted, retryGeneration, runGeneration } from '../src/engine/jobs';
import { reconcileLlmCharge } from '../src/engine/money/llmSend';
import { resetSendLocks } from '../src/engine/money/paidSend';
import { sendGenerationViaPaidGate, storeTickets } from '../src/engine/money/storeBridge';
import { compactApprovalTickets, createTicket, exactPrice } from '../src/engine/money/ticket';
import type { CommandApprovalFeedItem, GenNodeData, ModelSummary, PlanFeedItem } from '../src/engine/types';
import { createFakeProvider, jsonResponse, simulateReload, snapshotStore, sseResponse, type FakeProvider } from './helpers/fakeProvider';

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

const check = rawCheck as (root: string) => string[];
const modelRef = 'nanogpt::paid-img';
const localRef = 'local::test';
const llmModel = 'paid-llm';
let sid: string;
let fake: FakeProvider;

beforeEach(() => {
  blobs.clear();
  resetSendLocks();
  useAlerts.setState({ alerts: [] });
  setApprover(null);
  fake = createFakeProvider();
  fake.install();
  const fresh = createSession('D+ Hydrogen adversarial');
  sid = fresh.id;
  const node: GenNodeData = {
    kind: 'image', title: 'Reviewed', prompt: 'reviewed prompt', modelRef,
    settings: { count: 1, advanced: {} }, outputIndex: 0,
  };
  const paidModel = {
    ref: modelRef, provider: 'nanogpt', id: 'paid-img', name: 'Paid image', kind: 'image',
    acceptsText: true, acceptsImage: true, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] },
  } as unknown as ModelSummary;
  const localModel = {
    ref: localRef, provider: 'local', id: 'test', name: 'Local test', kind: 'image',
    acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'output', usd: 0 }] },
  } as unknown as ModelSummary;
  useStore.setState((state) => ({
    activeSessionId: sid,
    sessions: { [sid]: { ...fresh, graph: { nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: node }], edges: [] } } },
    generations: {}, tickets: {}, spendLog: [], spentUsd: 0, quotes: {}, assets: {}, library: [],
    catalog: {
      ...state.catalog,
      models: { [modelRef]: paidModel, [localRef]: localModel },
      schemas: {
        [modelRef]: { ref: modelRef, params: [], slots: { prompt: 'prompt', promptRequired: true, images: { key: 'imageDataUrls', min: 0, max: 4, multiple: true, format: 'data-url' } }, source: 'catalog' },
        [localRef]: { ref: localRef, params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' },
      },
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
  blobs.clear();
  useAlerts.setState({ alerts: [] });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function scanFixture(file: string, content: string): string[] {
  const root = mkdtempSync(join(tmpdir(), 'ogs-dplus-h2-'));
  try {
    const target = join(root, file);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content);
    return check(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// --- Findings ---

it('H1: requires charge confirmation before retrying a paid LLM turn whose thinking exhausted output with empty text', async () => {
  useStore.setState((state) => ({ settings: { ...state.settings, budgetOn: false } }));
  fake.onNext('/chat/completions', () =>
    sseResponse([
      { choices: [{ delta: { reasoning_content: 'spent all tokens thinking' }, finish_reason: 'length' }] },
      { choices: [], usage: { prompt_tokens: 100, completion_tokens: 500, cost: 0.05 } },
    ]),
  );
  await llmTurn(sid, 'chat', { route: 'new', agentNodeId: 'main' });
  expect(fake.acceptedCount('/chat/completions')).toBe(1);
  expect(useStore.getState().spentUsd).toBeCloseTo(0.05, 6);
  const notice = useStore.getState().sessions[sid].feed.find((item) => item.type === 'notice' && item.retry);
  expect(notice).toBeDefined();
  await retryAgentTurn(sid, notice!.id);
  expect(fake.acceptedCount('/chat/completions'), 'plain Retry re-sent an already-charged empty/length LLM call without confirmation').toBe(1);
});

// reproduce: studio.generate.start has no review() or signature verification, so approving a restored card executes an edited live composer prompt without re-review.
it.fails('H2: requires re-review when live composer changes before approving a restored studio.generate.start command card', async () => {
  setComposer({ text: 'reviewed composer prompt' });
  setComposerMedia('image', { modelRef });
  const pending = runCommandsTool(sid, { seq: [{ cmd: 'studio.generate.start', args: { kind: 'image' } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));
  const card = commandCard();
  const saved = snapshotStore();
  decideCommandApproval(sid, card.id, 'cancel');
  await pending;

  simulateReload(null, { sessionId: sid, state: saved });
  settleInterruptedPlans();
  setComposer({ text: 'unreviewed edited composer prompt' });
  expect(decideCommandApproval(sid, card.id, 'approve')).toBe(true);
  await vi.waitFor(() => expect(commandCard().status).not.toBe('running'));
  expect(fake.acceptedCount('unreviewed edited composer prompt'), 'restored studio.generate.start sent an unreviewed prompt').toBe(0);
});

it('H3a: allows approving a restored free/local command card after reload', async () => {
  patchNodeData(sid, 'n1', { modelRef: localRef, prompt: 'local reviewed' });
  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n1'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));
  const card = commandCard();
  const saved = snapshotStore();
  decideCommandApproval(sid, card.id, 'cancel');
  await pending;

  simulateReload(null, { sessionId: sid, state: saved });
  settleInterruptedPlans();
  expect(decideCommandApproval(sid, card.id, 'approve'), 'restored free/local command card cannot be approved').toBe(true);
  await vi.waitFor(() => expect(commandCard().status).toBe('done'));
});

it('H3b: re-offers a live free/local command card for review when the node is edited to a paid model before approval', async () => {
  patchNodeData(sid, 'n1', { modelRef: localRef, prompt: 'local initial' });
  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n1'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));
  const card = commandCard();

  expect(patchNodeData(sid, 'n1', { modelRef, prompt: 'now paid prompt' })).toBeNull();
  expect(decideCommandApproval(sid, card.id, 'approve')).toBe(true);
  await pending;
  expect(fake.acceptedCount('now paid prompt')).toBe(0);
  expect(commandCard().status, 'free command card transitioned to dead error instead of re-offering paid review').toBe('awaiting');
});

// reproduce: nodeRequest omits asset revisions for mentioned @Subject assets, so editing the asset in-place keeps preview.signature identical and sends unreviewed bytes.
it.fails('H4: invalidates nodes.run.start command review signature when a mentioned @Subject asset is edited in-place', async () => {
  const originalBlob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
  blobs.set('asset_hero', originalBlob);
  useStore.setState(() => ({
    assets: {
      asset_hero: {
        id: 'asset_hero', kind: 'image', mime: 'image/png', width: 64, height: 64,
        sessionId: sid, origin: 'upload', stored: true, favorite: false, createdAt: 1,
      },
    },
    library: [{ id: 'sub_hero', name: 'Hero', kind: 'character', description: 'protagonist', frontalAssetId: 'asset_hero', refAssetIds: [] }],
  }));
  patchNodeData(sid, 'n1', { prompt: 'portrait of @Hero' });

  const pending = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n1'], force: true } }] });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));
  const card = commandCard();
  const saved = snapshotStore();
  decideCommandApproval(sid, card.id, 'cancel');
  await pending;

  simulateReload(null, { sessionId: sid, state: saved });
  settleInterruptedPlans();
  const editedBlob = new Blob([new Uint8Array([9, 8, 7, 6, 5])], { type: 'image/png' });
  expect(await saveAssetEdit('asset_hero', editedBlob, 'original', { width: 128, height: 128 })).not.toBeNull();

  expect(decideCommandApproval(sid, card.id, 'approve')).toBe(true);
  await vi.waitFor(() => expect(commandCard().status).not.toBe('running'));
  expect(Object.values(useStore.getState().generations).every((g) => g.status !== 'error')).toBe(true);
  expect(fake.acceptedCount(), 'nodes.run.start sent an edited subject asset under the prior signature').toBe(0);
  expect(commandCard().status).toBe('awaiting');
});

// reproduce: an uncertain prompt-rewrite LLM call leaves a held reservation with no feed reconciliation notice or UI way to close/release it.
it.fails('H5: provides explicit reconciliation for an uncertain prompt-rewrite LLM call and avoids blocking subsequent rewrites forever', async () => {
  const item: PlanFeedItem = {
    id: 'plan-rw', createdAt: 1, type: 'plan', style: 'auto', workspace: 'chat', status: 'awaiting',
    plan: {
      id: 'pln-rw', title: 'Rewrite plan', summary: '', workspace: 'chat', style: '', subjects: [], adjustments: [],
      steps: [{ id: 's1', kind: 'image', title: 'Shot 1', prompt: 'initial prompt', modelRef, settings: { count: 1, advanced: {} }, refs: [] }],
    },
    stepStates: {}, stepGenerations: {}, estimate: { usd: 0.1, approximate: false },
  };
  useStore.setState((state) => ({
    sessions: { [sid]: { ...state.sessions[sid], feed: [item] } },
  }));

  fake.onNext('/chat/completions', 'cut-after-accept');
  await rewritePrompts(sid, item.id, 'image', undefined, undefined, { budgetPass: true });
  expect(fake.acceptedCount('/chat/completions')).toBe(1);
  expect(remainingBudget()).toBeCloseTo(0.96, 6);

  const feedNotice = useStore.getState().sessions[sid].feed.find((f) =>
    f.type === 'notice' && Boolean(f.uncertainLlmTicketId || f.meta?.runId),
  );
  expect(feedNotice, 'uncertain prompt rewrite left no feed notice with explicit reconciliation action').toBeDefined();
});

// reproduce: createGeneration skips updating approval.pass on a shared cmd ticket once pass is set, blocking the second paid studio step with PASS_EXCEEDED.
it.fails('H6: allows a second paid studio step in a command sequence approved with "Allow this time"', async () => {
  useStore.setState((state) => ({ settings: { ...state.settings, budgetUsd: 0.15 } }));
  setComposer({ text: 'studio step prompt' });
  setComposerMedia('image', { modelRef });

  const pending = runCommandsTool(sid, {
    seq: [
      { cmd: 'studio.generate.start', args: { kind: 'image' } },
      { cmd: 'studio.generate.start', args: { kind: 'image' } },
    ],
  });
  const commandCard = () => useStore.getState().sessions[sid].feed.find((item): item is CommandApprovalFeedItem => item.type === 'commands')!;
  await vi.waitFor(() => expect(commandCard()?.status).toBe('awaiting'));
  expect(decideCommandApproval(sid, commandCard().id, 'once')).toBe(true);
  await pending;
  await vi.waitFor(() => expect(Object.values(useStore.getState().generations).filter((g) => g.status === 'done' || g.status === 'error')).toHaveLength(2));
  expect(fake.acceptedCount('studio step prompt'), 'second approved studio step was blocked by un-updated ticket pass').toBe(2);
});

// reproduce: resolveStepCostReview consumes the user's new once pass without updating plan:<id>.pass.maxUsd, causing paidSend to reject the reviewed step with PASS_EXCEEDED.
it.fails('H7: updates plan ticket pass ceiling when user confirms a step price review with a once pass', async () => {
  useStore.setState((state) => ({ settings: { ...state.settings, budgetUsd: 0.15 } }));
  const item: PlanFeedItem = {
    id: 'plan-pr', createdAt: 1, type: 'plan', style: 'auto', workspace: 'chat', status: 'review',
    plan: {
      id: 'pln-pr', title: 'Review price plan', summary: '', workspace: 'chat', style: '', subjects: [], adjustments: [],
      steps: [{ id: 's1', kind: 'image', title: 'Shot 1', prompt: 'price jump', modelRef, settings: { count: 1, advanced: {} }, refs: [] }],
    },
    stepStates: { s1: 'review' }, stepGenerations: {}, estimate: { usd: 0.1, approximate: false },
  };
  const planTicket = createTicket({
    id: `plan:${item.id}`, sessionId: sid, kind: 'plan', scope: { steps: ['s1'] },
    price: exactPrice(0.1), pass: { kind: 'once', maxUsd: 0.1 },
  });
  useStore.setState((state) => ({
    sessions: { [sid]: { ...state.sessions[sid], feed: [item] } },
    tickets: { [planTicket.id]: planTicket },
  }));
  const g = createGeneration({
    sessionId: sid, kind: 'image', modelRef, prompt: 'price jump', settings: { count: 1, advanced: {} },
    origin: 'agent', planId: item.plan.id, stepId: 's1', approvalTicketId: planTicket.id,
    estimate: { usd: 0.1, approximate: false },
  });
  useStore.setState((state) => ({
    generations: {
      ...state.generations,
      [g.id]: {
        ...g,
        status: 'review',
        estimate: { usd: 0.5, approximate: false },
        retryBaseEstimate: { usd: 0.5, approximate: false },
      },
    },
    sessions: {
      [sid]: {
        ...state.sessions[sid],
        feed: [{
          ...item,
          stepAuthorizations: {
            s1: { modelRef, parameters: { count: 1, advanced: {} }, estimate: { usd: 0.1, approximate: false } },
          },
          stepGenerations: { s1: g.id },
          stepCostReviews: {
            s1: {
              message: 'Costs $0.50 instead of $0.10',
              reason: 'price changed',
              approved: { modelRef, parameters: { count: 1, advanced: {} }, estimate: { usd: 0.1, approximate: false } },
              proposed: { modelRef, parameters: { count: 1, advanced: {} }, estimate: { usd: 0.5, approximate: false } },
              decisions: [],
            },
          },
        }],
      },
    },
  }));

  await withOncePass(sid, (pass) => resolveStepCostReview(sid, item.id, 's1', 'continue', pass), 0.5);
  expect(fake.acceptedCount('price jump'), 'plan ticket kept stale $0.10 pass cap after user approved $0.50 review').toBe(1);
});

// reproduce: check-paid-send only inspects direct/indirect MemberExpression adapter calls and misses destructured or aliased adapter methods.
it.fails('H8a: check-paid-send flags a destructured or aliased billable adapter method outside the gate', () => {
  const diagnostics = scanFixture('src/engine/mediaAlias.ts', [
    'export function send(adapter: { generate(input: unknown): unknown }, input: unknown) {',
    '  const { generate } = adapter;',
    '  return generate(input);',
    '}',
  ].join('\n'));
  expect(diagnostics.join('\n')).toMatch(/mediaAlias\.ts:.*paidSend/);
});

// reproduce: check-paid-send only checks ObjectPattern destructuring and misses aliasing chat to a local identifier inside llmSend.ts.
it.fails('H8b: check-paid-send flags an identifier alias of chat inside llmSend.ts outside paidSend', () => {
  const diagnostics = scanFixture('src/engine/money/llmSend.ts', [
    "import { chat } from '../providers/llm';",
    'const rawChat = chat;',
    'export const bypass = (input: Parameters<typeof chat>[0]) => rawChat(input);',
  ].join('\n'));
  expect(diagnostics.join('\n')).toMatch(/llmSend\.ts:.*paidSend/);
});

// reproduce: check-paid-send tracks namespace identifiers only on import/dynamic-import and misses local aliases of llm or providerFetch namespaces.
it.fails('H8c: check-paid-send flags an aliased namespace import of llm or providerFetch outside allowed files', () => {
  const diagnostics = scanFixture('src/engine/nsAlias.ts', [
    "import * as llm from './providers/llm';",
    'const api = llm;',
    'export const bypass = (input: Parameters<typeof llm.chat>[0]) => api.chat(input);',
  ].join('\n'));
  expect(diagnostics.join('\n')).toMatch(/nsAlias\.ts:.*paidSend/);
});

// --- Controls ("Sin hallazgo (comprobado)") ---

it('control: lockKeys and slot status do not permanently lock a generation slot after pre-charge save or 402 failure', async () => {
  const g = createGeneration({
    sessionId: sid, kind: 'image', modelRef, prompt: 'retryable slot',
    settings: { count: 1, advanced: {} }, origin: 'composer', estimate: { usd: 0.1, approximate: false },
  });

  const send = vi.fn(async () => ({ value: 'ok', costUsd: 0.1 }));
  // 1) Simulate SAVE_FAILED (aborted/writer lock lost) -> rolls back to pending and releases lockKeys.
  useStore.setState((s) => ({ ...s, settings: { ...s.settings, budgetOn: true } }));
  fake.onNext('retryable slot', () => jsonResponse({ error: 'Insufficient credits' }, 402));
  await expect(runGeneration(g.id)).rejects.toThrow();
  expect(useStore.getState().tickets[`gen:${g.id}`].sends[0]?.status).toBe('failed');
  expect(remainingBudget()).toBeCloseTo(1, 6);

  // 2) Same (g.id, index=0) is allowed to send again after a pre-charge failure and releases lock cleanly.
  await sendGenerationViaPaidGate({ g, index: 0, signal: new AbortController().signal, send });
  expect(send).toHaveBeenCalledOnce();
});

it('control: compactApprovalTickets preserves uncertain reservations and settled generation receipts without double-counting after reload', async () => {
  const gDone = createGeneration({
    sessionId: sid, kind: 'image', modelRef, prompt: 'done image',
    settings: { count: 1, advanced: {} }, origin: 'composer', estimate: { usd: 0.1, approximate: false },
  });
  await runGeneration(gDone.id);
  const gLost = createGeneration({
    sessionId: sid, kind: 'image', modelRef, prompt: 'uncertain image',
    settings: { count: 1, advanced: {} }, origin: 'composer', estimate: { usd: 0.1, approximate: false },
  });
  fake.onNext('uncertain image', () => jsonResponse({ error: 'Upstream 500' }, 500));
  await expect(runGeneration(gLost.id)).rejects.toThrow();

  const saved = snapshotStore();
  const compacted = compactApprovalTickets(
    useStore.getState().tickets,
    useStore.getState().generations,
    useStore.getState().sessions,
  );
  expect(compacted[`gen:${gDone.id}`]).toBeUndefined();
  expect(compacted[`gen:${gLost.id}`]?.sends[0]?.status).toBe('uncertain');

  simulateReload(null, { sessionId: sid, state: saved });
  await resumeInterrupted();
  settleInterruptedPlans();

  expect(useStore.getState().spentUsd).toBeCloseTo(0.1, 6);
  expect(useStore.getState().spendLog).toHaveLength(1);
  expect(remainingBudget()).toBeCloseTo(0.8, 6);
  expect(useStore.getState().generations[gDone.id].sends?.[0]?.status).toBe('done');
  // Calling plain retry on gLost after reload still requires confirmation.
  await retryGeneration(gLost.id);
  expect(fake.acceptedCount('uncertain image')).toBe(1);
});

it('control: reconcileLlmCharge settles an uncertain turn once and releases its reservation', async () => {
  const ticket = createTicket({
    id: 'llm:reconcile-ctrl',
    sessionId: sid,
    kind: 'llm',
    scope: { llm: { provider: 'nanogpt', model: llmModel } },
    price: { kind: 'estimated', usd: 0.04, maxVerifiableUsd: null },
    sends: [{
      id: 'send-u1',
      slotKey: 'llm:reconcile-ctrl:send-u1',
      index: 0,
      status: 'uncertain',
      price: { kind: 'estimated', usd: 0.04, maxVerifiableUsd: null },
      reservedUsd: 0.04,
      updatedAt: 1,
    }],
  });
  storeTickets.put(ticket);
  expect(remainingBudget()).toBeCloseTo(0.96, 6);

  expect(reconcileLlmCharge(sid, ticket.id)).toBe(true);
  expect(reconcileLlmCharge(sid, ticket.id)).toBe(false);
  expect(remainingBudget()).toBeCloseTo(1, 6);
  expect(useStore.getState().spendLog.filter((e) => e.sendId === 'send-u1')).toHaveLength(1);
});
