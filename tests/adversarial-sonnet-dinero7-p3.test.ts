import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, {
  window: { setTimeout, clearTimeout, addEventListener: () => undefined },
  document: { addEventListener: () => undefined, visibilityState: 'visible' },
}));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => new Blob([new Uint8Array([1])], { type: 'image/png' }),
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
}));
vi.mock('../src/lib/media', async (orig) => ({
  ...(await orig<typeof import('../src/lib/media')>()),
  probeMedia: async () => ({ width: 64, height: 64, size: 1 }),
  jpegThumbnail: async () => undefined,
}));

const quoteOverride = vi.hoisted(() => ({ usd: undefined as number | null | undefined, ref: '' }));
vi.mock('../src/engine/retryPartial', async (orig) => {
  const real = await orig<typeof import('../src/engine/retryPartial')>();
  return { ...real, estimateForRetry: (g: Parameters<typeof real.estimateForRetry>[0]) => (quoteOverride.usd !== undefined && g.modelRef === quoteOverride.ref ? { usd: quoteOverride.usd, approximate: quoteOverride.usd == null } : real.estimateForRetry(g)) };
});

import { useStore, patchGeneration } from '../src/store/store';
import { askAgain, budgetVerdict, passActiveFor, takeGenerationPass, withOncePass } from '../src/engine/budget';
import { cancelGeneration, createGeneration, type GenerationSpec } from '../src/engine/jobs';
import { deleteGeneration } from '../src/engine/assetActions';
import { deleteSession } from '../src/engine/actions';
import { forgetBalances, onGenerationCredit } from '../src/engine/credit';
import { ADAPTERS } from '../src/engine/providers/registry';
import { HttpError } from '../src/lib/http';
import { runGeneration } from '../src/engine/jobs';
import { useAlerts } from '../src/engine/alerts';
import type { ModelSummary } from '../src/engine/types';

const NANO = 'nanogpt::seed';
const ATLAS = 'atlas::seed';
const mkModel = (provider: 'nanogpt' | 'atlas', usd: number): ModelSummary => ({
  ref: `${provider}::seed`,
  provider,
  id: 'seed',
  name: 'seed',
  kind: 'image',
  acceptsText: true,
  acceptsImage: false,
  tags: [],
  price: { skus: [{ unit: 'output', usd }] },
}) as unknown as ModelSummary;

const settings = { count: 1, advanced: {} };
const paid = { usd: 0.1, approximate: false };
let sid: string;

const spec = (over: Partial<GenerationSpec> = {}): GenerationSpec => ({
  sessionId: sid,
  origin: 'composer',
  kind: 'image',
  prompt: 'test',
  modelRef: NANO,
  settings,
  inputs: { refs: [] },
  estimate: paid,
  ...over,
});

beforeEach(() => {
  const st = useStore.getState();
  sid = st.activeSessionId;
  askAgain(sid);
  useAlerts.setState({ alerts: [] });
  forgetBalances();
  const schema = { params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' };
  useStore.setState({
    generations: {},
    quotes: {},
    assets: {},
    spendLog: [],
    spentUsd: 1.0,
    settings: {
      ...st.settings,
      autoSwitchProvider: 'always',
      keys: { ...st.settings.keys, nanogpt: 'k', atlas: 'k' },
      budgetOn: true,
      budgetUsd: 1.0,
      budgetAccepted: null,
      budgetNoAsk: false,
    },
    catalog: {
      ...st.catalog,
      models: { [NANO]: mkModel('nanogpt', 0.1), [ATLAS]: mkModel('atlas', 0.08) },
      schemas: { [NANO]: { ref: NANO, ...schema }, [ATLAS]: { ref: ATLAS, ...schema } } as never,
    },
    sessions: {
      ...st.sessions,
      [sid]: { ...st.sessions[sid], feed: [], noAskOverLimit: false, graph: { nodes: [], edges: [] } },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  useAlerts.setState({ alerts: [] });
});


import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error -- plain ESM check script
import { check } from '../scripts/check-budget-verdict.mjs';

describe('Attack 3a: passes that outlive their action', () => {
  // Finding P1 (new): a generation created with a Continue once pass keeps a live substitute pass in activePasses
  // after the approved action ended, if it is never run (deleted, aborted before runGeneration, session closed).
  it('a pass bound to a generation that never ran (aborted or deleted before runGeneration) is dead once the approving action has ended', async () => {
    let genId = '';
    await withOncePass(sid, async (pass) => { genId = createGeneration(spec({ budgetPass: pass })).id; });
    const leaked = takeGenerationPass(genId, paid);
    expect(leaked ? passActiveFor(leaked, sid) : false).toBe(false);
    // and it cannot pay for another over-limit run
    expect(leaked ? budgetVerdict(paid, { sessionId: sid, pass: leaked }).over : true).toBe(true);
  });

  it('a bound generation pass is released when the generation is canceled, deleted, or its session is closed', () => {
    withOncePass(sid, (pass) => {
      const g = createGeneration(spec({ budgetPass: pass }));
      cancelGeneration(g.id);
      expect(takeGenerationPass(g.id, paid)).toBeUndefined();
    });
    withOncePass(sid, (pass) => {
      const g = createGeneration(spec({ budgetPass: pass }));
      deleteGeneration(g.id);
      expect(takeGenerationPass(g.id, paid)).toBeUndefined();
    });
    const doomed = sid;
    withOncePass(doomed, (pass) => {
      const g = createGeneration(spec({ sessionId: doomed, budgetPass: pass }));
      deleteSession(doomed);
      expect(takeGenerationPass(g.id, paid)).toBeUndefined();
    });
  });

  it('onGenerationCredit retires the taken substitute pass in finally even if rerun throws synchronously before consumeOnce', async () => {
    vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(5);
    let genId = '';
    let takenDuring: ReturnType<typeof takeGenerationPass>;
    await withOncePass(sid, async (pass) => {
      const g = createGeneration(spec({ budgetPass: pass }));
      genId = g.id;
      patchGeneration(g.id, { status: 'error', startedAt: Date.now() });
      const throwingRerun = () => { throw new Error('sync boom before consumeOnce'); };
      await expect(onGenerationCredit(g.id, throwingRerun as never)).rejects.toThrow('sync boom before consumeOnce');
      takenDuring = takeGenerationPass(g.id, paid);
    });
    expect(takenDuring).toBeUndefined();
    expect(takeGenerationPass(genId, paid)).toBeUndefined();
    expect(budgetVerdict(paid, { sessionId: sid }).over).toBe(true);
  });
});

describe('Attack 3a: check-budget-verdict can be dodged', () => {
  const withRepo = (files: Record<string, string>, fn: (root: string) => void) => {
    const root = mkdtempSync(join(tmpdir(), 'ogs-sonnet-bv-'));
    try {
      for (const [rel, text] of Object.entries(files)) {
        const full = join(root, rel);
        mkdirSync(full.slice(0, full.lastIndexOf('/')), { recursive: true });
        writeFileSync(full, text);
      }
      fn(root);
    } finally { rmSync(root, { recursive: true, force: true }); }
  };
  // Finding P2 (new): destructuring a namespace import is not reported (only dynamic import destructuring is).
  it('flags `const { budgetVerdict } = B` on a namespace import outside the boundary', () => {
    withRepo({
      'src/engine/budget.ts': 'export const budgetVerdict = () => ({ over: false });',
      'src/components/chat/Dodge.tsx': "import * as B from '../../engine/budget'; const { budgetVerdict } = B; export const x = budgetVerdict;",
    }, (root) => {
      expect((check(root) as string[]).some((e) => e.startsWith('src/components/chat/Dodge.tsx:'))).toBe(true);
    });
  });
});

describe('Re-attack 3b: deferred 402 substitute pass in ask mode', () => {
  // Finding Q1 (new, low-medium): the deferred entitlement is not bound to the approved amount. If the substitute's
  // estimate (e.g. an Atlas quote) is higher than what the user approved, "Yes, this time" spends it without asking.
  it('ask mode: a substitute whose estimate exceeds the approved $0.10 still asks for the limit', async () => {
    useStore.setState((s) => ({ settings: { ...s.settings, autoSwitchProvider: 'ask' } }));
    vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(5);
    let atlasCalls = 0;
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockRejectedValue(new HttpError(402, 'Insufficient credits', null));
    vi.spyOn(ADAPTERS.atlas, 'generate').mockImplementation(async () => {
      atlasCalls++;
      return { outputs: [{ blob: new Blob(['i'], { type: 'image/png' }), mime: 'image/png' }], costUsd: 0.5 };
    });
    await withOncePass(sid, async (pass) => {
      const g = createGeneration(spec({ budgetPass: pass }));
      await runGeneration(g.id).catch(() => undefined);
    });
    const offer = useAlerts.getState().alerts.find((a) => a.actions?.some((x) => x.label === 'Yes, this time'))!;
    quoteOverride.ref = ATLAS;
    quoteOverride.usd = 0.5;
    try {
      offer.actions!.find((x) => x.label === 'Yes, this time')!.run();
      await vi.waitFor(() => expect(atlasCalls > 0 || useAlerts.getState().alerts.some((a) => a.actions?.some((x) => x.label === "Continue once"))).toBe(true));
    } finally { quoteOverride.usd = undefined; }
    expect(atlasCalls).toBe(0);
    expect(useAlerts.getState().alerts.some((a) => a.actions?.some((x) => x.label === 'Continue once'))).toBe(true);
  });

  it('always mode: a substitute whose estimate exceeds the approved $0.10 still asks for the limit', async () => {
    useStore.setState((s) => ({ settings: { ...s.settings, autoSwitchProvider: 'always' } }));
    vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(5);
    let atlasCalls = 0;
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockRejectedValue(new HttpError(402, 'Insufficient credits', null));
    vi.spyOn(ADAPTERS.atlas, 'generate').mockImplementation(async () => {
      atlasCalls++;
      return { outputs: [{ blob: new Blob(['i'], { type: 'image/png' }), mime: 'image/png' }], costUsd: 0.5 };
    });
    quoteOverride.ref = ATLAS;
    quoteOverride.usd = 0.5;
    let genId = '';
    try {
      await withOncePass(sid, async (pass) => {
        const g = createGeneration(spec({ budgetPass: pass }));
        genId = g.id;
        await runGeneration(g.id).catch(() => undefined);
      });
    } finally { quoteOverride.usd = undefined; }
    expect(atlasCalls).toBe(0);
    const prompt = useAlerts.getState().alerts.find((a) => a.actions?.some((x) => x.label === 'Continue once'));
    expect(prompt).toBeDefined();
    // Explicitly approving the pricier substitute runs it once and completes the generation.
    prompt!.actions!.find((x) => x.label === 'Continue once')!.run();
    await vi.waitFor(() => expect(useStore.getState().generations[genId]?.status).toBe('done'));
    expect(atlasCalls).toBe(1);
  });

  it.each(['ask', 'always'] as const)('%s mode: a substitute with an unknown estimate still asks for the limit', async (mode) => {
    useStore.setState((s) => ({ settings: { ...s.settings, autoSwitchProvider: mode } }));
    vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(5);
    let atlasCalls = 0;
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockRejectedValue(new HttpError(402, 'Insufficient credits', null));
    vi.spyOn(ADAPTERS.atlas, 'generate').mockImplementation(async () => {
      atlasCalls++;
      return { outputs: [{ blob: new Blob(['i'], { type: 'image/png' }), mime: 'image/png' }], costUsd: 0.08 };
    });
    quoteOverride.ref = ATLAS;
    quoteOverride.usd = mode === 'always' ? null : undefined;
    try {
      await withOncePass(sid, async (pass) => {
        const g = createGeneration(spec({ budgetPass: pass }));
        await runGeneration(g.id).catch(() => undefined);
      });
      if (mode === 'ask') {
        const offer = useAlerts.getState().alerts.find((a) => a.actions?.some((x) => x.label === 'Yes, this time'))!;
        quoteOverride.usd = null;
        offer.actions!.find((x) => x.label === 'Yes, this time')!.run();
        await vi.waitFor(() => expect(atlasCalls > 0 || useAlerts.getState().alerts.some((a) => a.actions?.some((x) => x.label === 'Continue once'))).toBe(true));
      }
    } finally { quoteOverride.usd = undefined; }
    expect(atlasCalls).toBe(0);
    expect(useAlerts.getState().alerts.some((a) => a.actions?.some((x) => x.label === 'Continue once'))).toBe(true);
  });
});
