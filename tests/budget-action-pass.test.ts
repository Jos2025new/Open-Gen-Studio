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
import { askAgain, beginOncePass, budgetVerdict, OverLimitError, overLimit, withOncePass, type BudgetPass } from '../src/engine/budget';
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

describe('per-action budget pass and single budgetVerdict', () => {
  it('two actions in the same session: one has Continue once, the other still asks and cannot steal it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });

    let otherOverDuring = false;
    let otherProblemDuring: string | null = null;
    let otherBlocked = false;
    let action1CreatedId: string | undefined;

    const action1 = withOncePass(sid, async (pass) => {
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
    const grant = beginOncePass(sid);
    try {
      expect(overLimit(paid, sid)).toBe(true);
      expect(budgetProblem(paid, sid)).not.toBeNull();
      expect(() => createGeneration(spec())).toThrow(OverLimitError);
      // Only the sequence holding grant.pass passes
      expect(budgetVerdict(paid, { sessionId: sid, pass: grant.pass }).over).toBe(false);
    } finally {
      grant.end();
    }
    expect(budgetVerdict(paid, { sessionId: sid, pass: grant.pass }).over).toBe(true);
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
    await withOncePass(sid, async (pass) => {
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
    expect(budgetVerdict({ usd: 0, approximate: false }, { sessionId: sid }).over).toBe(false);
    expect(budgetVerdict({ usd: null, approximate: true }, { sessionId: sid }).over).toBe(true);
    // Forged pass object never works
    const forged: BudgetPass = { sessionId: sid, kind: 'once' };
    expect(budgetVerdict(paid, { sessionId: sid, pass: forged }).over).toBe(true);
    // No pass is persisted in store state
    withOncePass(sid, () => {
      const serialized = JSON.stringify(useStore.getState().sessions[sid]);
      expect(serialized).not.toContain('oncePass');
      expect(serialized).not.toContain('budgetPass');
    });
  });

  it('402 substitute in ask mode after Continue once: "Yes, this time" does not ask a second time for the same limit', async () => {
    useStore.setState((s) => ({ settings: { ...s.settings, autoSwitchProvider: 'ask' } }));
    vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(5);
    let atlasCalls = 0;
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockRejectedValue(new HttpError(402, 'Insufficient credits', null));
    vi.spyOn(ADAPTERS.atlas, 'generate').mockImplementation(async () => {
      atlasCalls++;
      return { outputs: [{ blob: new Blob(['i'], { type: 'image/png' }), mime: 'image/png' }], costUsd: 0.08 };
    });

    let genId = '';
    await withOncePass(sid, async (pass) => {
      const g = createGeneration(spec({ budgetPass: pass }));
      genId = g.id;
      await runGeneration(g.id).catch(() => undefined);
    });

    const offer = useAlerts.getState().alerts.find((a) => a.actions?.some((x) => x.label === 'Yes, this time'));
    expect(offer).toBeDefined();
    // While the 402 alert waits, another unrelated action in the same session still asks and cannot steal the pass.
    expect(overLimit(paid, sid)).toBe(true);
    expect(() => createGeneration(spec())).toThrow(OverLimitError);

    offer!.actions!.find((x) => x.label === 'Yes, this time')!.run();
    await vi.waitFor(() => expect(useStore.getState().generations[genId]?.status).toBe('done'));

    expect(atlasCalls).toBe(1);
    expect(useAlerts.getState().alerts.some((a) => a.actions?.some((x) => x.label === 'Continue once'))).toBe(false);
    // And after finishing, a second action still asks.
    expect(overLimit(paid, sid)).toBe(true);
    expect(() => createGeneration(spec())).toThrow(OverLimitError);
  });

  it('402 substitute in ask mode still asks if the limit changed, askAgain ran, or the substitute is pricier', async () => {
    vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(5);
    let atlasCalls = 0;
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockRejectedValue(new HttpError(402, 'Insufficient credits', null));
    vi.spyOn(ADAPTERS.atlas, 'generate').mockImplementation(async () => {
      atlasCalls++;
      return { outputs: [{ blob: new Blob(['i'], { type: 'image/png' }), mime: 'image/png' }], costUsd: 0.08 };
    });

    // 1. Limit lowered after approval -> must ask again for the new limit.
    useStore.setState((s) => ({ settings: { ...s.settings, autoSwitchProvider: 'ask', budgetUsd: 1.0 } }));
    await withOncePass(sid, async (pass) => {
      const g = createGeneration(spec({ budgetPass: pass }));
      await runGeneration(g.id).catch(() => undefined);
    });
    const offer1 = useAlerts.getState().alerts.find((a) => a.actions?.some((x) => x.label === 'Yes, this time'))!;
    useStore.setState((s) => ({ settings: { ...s.settings, budgetUsd: 0.5 } }));
    offer1.actions!.find((x) => x.label === 'Yes, this time')!.run();
    await new Promise((r) => setTimeout(r, 20));
    expect(atlasCalls).toBe(0);
    expect(useAlerts.getState().alerts.some((a) => a.actions?.some((x) => x.label === 'Continue once'))).toBe(true);

    // 2. askAgain called before answering -> must ask again.
    useAlerts.setState({ alerts: [] });
    useStore.setState((s) => ({ settings: { ...s.settings, budgetUsd: 1.0 } }));
    await withOncePass(sid, async (pass) => {
      const g = createGeneration(spec({ budgetPass: pass }));
      await runGeneration(g.id).catch(() => undefined);
    });
    const offer2 = useAlerts.getState().alerts.find((a) => a.actions?.some((x) => x.label === 'Yes, this time'))!;
    askAgain(sid);
    offer2.actions!.find((x) => x.label === 'Yes, this time')!.run();
    await new Promise((r) => setTimeout(r, 20));
    expect(atlasCalls).toBe(0);
    expect(useAlerts.getState().alerts.some((a) => a.actions?.some((x) => x.label === 'Continue once'))).toBe(true);

    // 3. Pricier substitute ($0.14 > $0.10) -> still asks even though original had Continue once.
    useAlerts.setState({ alerts: [] });
    useStore.setState((s) => ({ catalog: { ...s.catalog, models: { ...s.catalog.models, [ATLAS]: mkModel('atlas', 0.14) } } }));
    await withOncePass(sid, async (pass) => {
      const g = createGeneration(spec({ budgetPass: pass }));
      await runGeneration(g.id).catch(() => undefined);
    });
    const offer3 = useAlerts.getState().alerts.find((a) => a.actions?.some((x) => x.label.includes('Atlas')))!;
    offer3.actions!.find((x) => x.label.includes('Atlas'))!.run();
    await new Promise((r) => setTimeout(r, 20));
    expect(atlasCalls).toBe(0);
    expect(useAlerts.getState().alerts.some((a) => a.actions?.some((x) => x.label === 'Continue once'))).toBe(true);
  });
});
