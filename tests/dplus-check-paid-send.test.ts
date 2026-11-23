// @vitest-environment jsdom
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const idb = vi.hoisted(() => ({ lastRaw: undefined as string | undefined }));
vi.mock('../src/lib/idb', () => ({
  stateDb: {
    get: async () => idb.lastRaw,
    set: async (_name: string, val: string | { text?: () => string }) => {
      idb.lastRaw = typeof val === 'string' ? val : val?.text?.();
      return { ok: true };
    },
    del: async () => undefined,
  },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  getAssetBlob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
}));
vi.mock('../src/lib/media', async (orig) => ({
  ...(await orig<typeof import('../src/lib/media')>()),
  probeMedia: async () => ({ width: 64, height: 64, size: 3 }),
  blobToDataUrl: async () => 'data:image/png;base64,cG5n',
  prepareImageForUpload: async (blob: Blob) => blob,
  jpegThumbnail: async () => undefined,
}));

import '../src/engine/commands';
// @ts-expect-error .mjs script has no .d.ts
import { check as rawCheck } from '../scripts/check-paid-send.mjs';
const check = rawCheck as (root?: string) => string[];
import { askAgain, remainingBudget } from '../src/engine/budget';
import { decideCommandApproval, runCommandsTool } from '../src/engine/agent/commandCalls';
import { settleInterruptedPlans } from '../src/engine/agent/runtime';
import { setApprover } from '../src/engine/commands';
import { sendLlmViaPaidGate } from '../src/engine/money/llmSend';
import { resetActions } from '../src/engine/nodecore/action';
import { createSession, useStore } from '../src/store/store';
import type { CommandApprovalFeedItem, ModelSummary } from '../src/engine/types';
import { createFakeProvider, simulateReload, snapshotStore, sseResponse, type FakeProvider } from './helpers/fakeProvider';

function withTempRoot(files: Record<string, string>, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'ogs-paid-send-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = join(root, rel);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, content);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('check-paid-send rule', () => {
  it('passes on the real repository with zero violations', () => {
    expect(check('.')).toEqual([]);
  });

  it('flags billable LLM chat(), adapter methods, and direct providerFetch outside paidSend with file:line and fix hint', () => {
    withTempRoot(
      {
        'src/engine/rogueLlm.ts': [
          "import { chat } from './providers/llm';",
          'export const bad = () => chat({} as never);',
        ].join('\n'),
        'src/engine/money/llmSend.ts': [
          "import { chat } from '../providers/llm';",
          'export const ungated = () => chat({} as never);',
        ].join('\n'),
        'src/engine/rogueMedia.ts': [
          'export const bad = (adapter: { generate: (x: unknown) => void }) => adapter.generate({});',
        ].join('\n'),
        'src/engine/jobs.ts': [
          'export const ungated = (adapter: { generate: (x: unknown) => void }) => adapter.generate({});',
        ].join('\n'),
        'src/engine/rogueFetch.ts': [
          "import { providerFetch } from '../lib/providerFetch';",
          'export const bad = () => providerFetch("https://example.test", { method: "POST" });',
        ].join('\n'),
      },
      (root) => {
        const errors = check(root);
        expect(errors.some((e) => /^src\/engine\/rogueLlm\.ts:1:.*sendLlmViaPaidGate/.test(e))).toBe(true);
        expect(errors.some((e) => /^src\/engine\/money\/llmSend\.ts:2:.*outside `paidSend\(\)`/.test(e))).toBe(true);
        expect(errors.some((e) => /^src\/engine\/rogueMedia\.ts:1:.*\.generate\(\).*paidSend/.test(e))).toBe(true);
        expect(errors.some((e) => /^src\/engine\/jobs\.ts:1:.*outside `sendGenerationViaPaidGate`/.test(e))).toBe(true);
        expect(errors.some((e) => /^src\/engine\/rogueFetch\.ts:1:.*providerFetch.*paidSend/.test(e))).toBe(true);
      },
    );
  });
});

describe('D+ 2b-3/2b-4: llmSend and $N command replay across reload', () => {
  let fake: FakeProvider;
  let sid: string;

  beforeEach(() => {
    idb.lastRaw = undefined;
    setApprover(null);
    resetActions();
    fake = createFakeProvider({ defaultImageCost: 0.1, defaultLlmCost: 0.01 });
    fake.install();
    const fresh = createSession('D+ Unit');
    sid = fresh.id;
    const st = useStore.getState();
    const imgModel = {
      ref: 'nanogpt::paid-img', provider: 'nanogpt', id: 'paid-img', name: 'Paid Img', kind: 'image',
      acceptsText: true, acceptsImage: true, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] },
    } as unknown as ModelSummary;
    useStore.setState({
      activeSessionId: sid,
      generations: {},
      tickets: {},
      spendLog: [],
      spentUsd: 0,
      sessions: { [sid]: { ...fresh, graph: { nodes: [], edges: [] }, feed: [], noAskOverLimit: false } },
      catalog: {
        ...st.catalog,
        models: { ...st.catalog.models, 'nanogpt::paid-img': imgModel },
        schemas: { ...st.catalog.schemas, 'nanogpt::paid-img': { ref: 'nanogpt::paid-img', params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' } },
        llm: { ...st.catalog.llm, nanogpt: [{ id: 'paid-llm', name: 'Paid LLM', inputPrice: 20, outputPrice: 40, tools: true, vision: false }] as never },
        llmStatus: { openrouter: 'idle', nanogpt: 'ready', atlas: 'idle' },
      },
      settings: {
        ...st.settings,
        keys: { ...st.settings.keys, nanogpt: 'k' },
        agent: { ...st.settings.agent, provider: 'nanogpt', model: 'paid-llm', effort: 'none' },
        budgetOn: true,
        budgetUsd: 0.1,
        budgetAccepted: null,
        budgetNoAsk: false,
      },
    });
    askAgain(sid);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetActions();
  });

  it('sendLlmViaPaidGate reserves synchronously, settles micro-cent cost idempotently by sendId, and releases reservation on 402', async () => {
    fake.onNext('/chat/completions', 'http-402');
    await expect(
      sendLlmViaPaidGate({
        ticketId: 'llm:t402',
        sessionId: sid,
        provider: 'nanogpt',
        apiKey: 'k',
        model: 'paid-llm',
        system: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [],
        signal: new AbortController().signal,
        computeUsd: (u) => u?.costUsd ?? 0,
      }),
    ).rejects.toThrow(/Insufficient credits/i);
    expect(remainingBudget()).toBeCloseTo(0.1, 6);

    fake.onNext('/chat/completions', () =>
      sseResponse([
        { choices: [{ delta: { content: 'Tiny.' }, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.00003 } },
      ]),
    );
    const out = await sendLlmViaPaidGate({
      ticketId: 'llm:tiny',
      sessionId: sid,
      provider: 'nanogpt',
      apiKey: 'k',
      model: 'paid-llm',
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      signal: new AbortController().signal,
      computeUsd: (u) => u?.costUsd ?? 0,
    });
    expect(out.costUsd).toBeCloseTo(0.00003, 6);
    expect(useStore.getState().spendLog.filter((e) => e.sendId === out.sendId)).toHaveLength(1);
    expect(useStore.getState().spendLog.find((e) => e.sendId === out.sendId)?.usd).toBeCloseTo(0.00003, 6);
  });

  it('command sequence with $N producer + spend + trailing write referencing $N replays cleanly after reload', async () => {
    useStore.setState((s) => ({ settings: { ...s.settings, budgetUsd: 1.0 } }));
    const oldRun = runCommandsTool(sid, {
      seq: [
        { cmd: 'nodes.node.add', args: { data: { kind: 'image', title: 'Draft', prompt: 'hero shot', modelRef: 'nanogpt::paid-img', settings: { count: 1, advanced: {} }, outputIndex: 0 }, position: { x: 0, y: 0 } } },
        { cmd: 'nodes.run.start', args: { targets: ['$1.node'], force: true } },
        { cmd: 'nodes.node.rename', args: { node: '$1.node', name: 'HeroRenamed' } },
      ],
    });
    await vi.waitFor(() => expect(useStore.getState().sessions[sid].feed.some((f) => f.type === 'commands' && f.status === 'awaiting')).toBe(true));
    const card = useStore.getState().sessions[sid].feed.find((f): f is CommandApprovalFeedItem => f.type === 'commands')!;
    const saved = snapshotStore();
    decideCommandApproval(sid, card.id, 'cancel');
    await oldRun;

    simulateReload(null, { sessionId: sid, state: saved });
    settleInterruptedPlans();
    expect(decideCommandApproval(sid, card.id, 'approve')).toBe(true);
    await vi.waitFor(() => {
      const latest = useStore.getState().sessions[sid].feed.find((f): f is CommandApprovalFeedItem => f.id === card.id)!;
      expect(latest.status).toBe('done');
    });
    expect(fake.acceptedCount('hero shot')).toBe(1);
    const nodes = useStore.getState().sessions[sid].graph.nodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data.title).toBe('HeroRenamed');
  });
});
