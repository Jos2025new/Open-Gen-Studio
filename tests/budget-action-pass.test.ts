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
}));
vi.mock('../src/lib/media', async (orig) => ({
  ...(await orig<typeof import('../src/lib/media')>()),
  probeMedia: async () => ({ width: 64, height: 64, size: 1 }),
  jpegThumbnail: async () => undefined,
}));

import { useStore } from '../src/store/store';
import * as budget from '../src/engine/budget';
import { askAgain, beginOncePass, OverLimitError, overLimit, withOncePass } from '../src/engine/budget';
import { budgetProblem } from '../src/engine/actions';
import { createGeneration, runGeneration, type GenerationSpec } from '../src/engine/jobs';
import { ADAPTERS } from '../src/engine/providers/registry';
import { forgetBalances } from '../src/engine/credit';
import { useAlerts } from '../src/engine/alerts';
import { HttpError } from '../src/lib/http';
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

const spec = (over: Partial<GenerationSpec> & { budgetPass?: unknown } = {}): GenerationSpec => ({
  sessionId: sid,
  origin: 'composer',
  kind: 'image',
  prompt: 'test',
  modelRef: NANO,
  settings,
  inputs: { refs: [] },
  estimate: paid,
  ...over,
} as GenerationSpec);

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

describe('per-action budget pass and single budgetVerdict', () => {
  it('two actions in the same session: one has Continue once, the other still asks and cannot steal it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });

    let otherOverDuring = false;
    let otherProblemDuring: string | null = null;
    let otherBlocked = false;
    let action1CreatedId: string | undefined;

    const action1 = (withOncePass as (s: string, fn: (pass: unknown) => Promise<void>) => Promise<void>)(sid, async (pass) => {
      await gate;
      const g = createGeneration(spec({ budgetPass: pass }));
      action1CreatedId = g.id;
    });

    // Action 2 starts in the SAME session while action 1 is suspended at await with its Continue once pass.
    otherOverDuring = overLimit(paid, sid);
    otherProblemDuring = budgetProblem(paid, sid);
    try {
      createGeneration(spec());
    } catch (err) {
      if (err instanceof OverLimitError) otherBlocked = true;
    }

    release();
    await action1;

    expect(otherOverDuring).toBe(true);
    expect(otherProblemDuring).not.toBeNull();
    expect(otherBlocked).toBe(true);
    expect(action1CreatedId).toBeDefined();
    expect(Object.keys(useStore.getState().generations)).toEqual([action1CreatedId]);
  });

  it('sequence pass (beginOncePass) belongs to its sequence, not to unrelated actions in the same session', () => {
    const grant = beginOncePass(sid) as unknown as { pass: unknown; end: () => void } | (() => void);
    const end = typeof grant === 'function' ? grant : grant.end;
    try {
      expect(overLimit(paid, sid)).toBe(true);
      expect(budgetProblem(paid, sid)).not.toBeNull();
      expect(() => createGeneration(spec())).toThrow(OverLimitError);
    } finally {
      end();
    }
  });

  it('pass survives an await and an automatic same-price 402 substitute, but never covers a second action or second generation', async () => {
    vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(5);
    let nanoCalls = 0;
    let atlasCalls = 0;
    let secondActionBlockedDuringSub = false;

    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementation(async () => {
      nanoCalls++;
      await new Promise((r) => setTimeout(r, 10));
      throw new HttpError(402, 'Insufficient credits', null);
    });
    vi.spyOn(ADAPTERS.atlas, 'generate').mockImplementation(async () => {
      atlasCalls++;
      // Another action in the same session during the 402 substitute must still be refused.
      try {
        createGeneration(spec());
      } catch (err) {
        if (err instanceof OverLimitError) secondActionBlockedDuringSub = true;
      }
      return { outputs: [{ blob: new Blob(['i'], { type: 'image/png' }), mime: 'image/png' }], costUsd: 0.08 };
    });

    let reusedPassBlocked = false;
    let genId = '';
    await (withOncePass as (s: string, fn: (pass: unknown) => Promise<void>) => Promise<void>)(sid, async (pass) => {
      // Survives an await before creating the generation
      await new Promise((r) => setTimeout(r, 10));
      const g = createGeneration(spec({ budgetPass: pass }));
      genId = g.id;
      // Reusing the same once-pass for a second generation must fail
      try {
        createGeneration(spec({ budgetPass: pass }));
      } catch (err) {
        if (err instanceof OverLimitError) reusedPassBlocked = true;
      }
      await runGeneration(g.id);
    });

    expect(nanoCalls).toBe(1);
    expect(atlasCalls).toBe(1);
    expect(useStore.getState().generations[genId]?.status).toBe('done');
    expect(secondActionBlockedDuringSub).toBe(true);
    expect(reusedPassBlocked).toBe(true);
    // And after finishing, a second action still asks
    expect(overLimit(paid, sid)).toBe(true);
    expect(() => createGeneration(spec())).toThrow(OverLimitError);
  });

  it('budgetVerdict is the single rule: $0 never stops, unknown price asks, pass is unforgeable and never persisted', () => {
    const verdict = (budget as unknown as { budgetVerdict?: (e: { usd: number | null; approximate: boolean }, opts?: { sessionId?: string; pass?: unknown }) => { over: boolean } }).budgetVerdict;
    expect(typeof verdict).toBe('function');
    expect(verdict!({ usd: 0, approximate: false }, { sessionId: sid }).over).toBe(false);
    expect(verdict!({ usd: null, approximate: true }, { sessionId: sid }).over).toBe(true);
    // Forged pass object never works
    expect(verdict!(paid, { sessionId: sid, pass: { sessionId: sid, kind: 'once' } }).over).toBe(true);
    // No pass is persisted in store state
    (withOncePass as (s: string, fn: (pass: unknown) => void) => void)(sid, () => {
      const serialized = JSON.stringify(useStore.getState().sessions[sid]);
      expect(serialized).not.toContain('oncePass');
      expect(serialized).not.toContain('budgetPass');
    });
  });
});
