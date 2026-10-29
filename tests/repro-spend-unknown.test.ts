import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));
const execute = vi.hoisted(() => vi.fn());
vi.mock('../src/engine/executor', async (orig) => ({ ...(await orig<typeof import('../src/engine/executor')>()), executeSteps: execute }));
import { useStore } from '../src/store/store';
import { overLimit } from '../src/engine/budget';
import { budgetProblem } from '../src/engine/actions';
import { runNodes } from '../src/engine/flow/actions';
import type { ModelSchema, ModelSummary } from '../src/engine/types';

// Repro (case 3): spending limit vs. a run whose price is unknown (usd null).
// DECISION NEEDED: what the app should do (ask, block, or warn "limit cannot be checked") is not decided in the docs
// (studio-controles/hallazgos.md H5). These tests assert only the minimum: a run must not pass the limit gate
// with no signal at all when the limit is already used up.
const unknown = { usd: null, approximate: true } as never;
const toasts = () => useStore.getState().ui.toasts.map((t) => t.text);

beforeEach(() => {
  useStore.setState((s) => ({ spentUsd: 5, ui: { ...s.ui, toasts: [] }, settings: { ...s.settings, budgetOn: true, budgetUsd: 5, budgetAccepted: null } }));
  execute.mockReset();
  execute.mockResolvedValue({ outputs: new Map(), failed: [], skipped: [], waiting: [] });
});

describe('repro 3: limit already used up and the price is unknown', () => {
  it('control: a KNOWN price over the exhausted limit is flagged', () => {
    expect(overLimit({ usd: 0.5, approximate: false } as never)).toBe(true);
  });

  // Cause: budget.ts:25-27 requires e.usd != null, so an unknown price is never "over"; budgetProblem (actions.ts:192-193) returns null.
  it('the gate does not report all-clear for an unknown price when nothing is left under the limit', () => {
    expect(overLimit(unknown) || budgetProblem(unknown) !== null).toBe(true);
  });

  // Cause: same gate; runNodes (flow/actions.ts:329) lets an unpriced node run start with limit exhausted and no toast.
  it('a Nodes run with an unpriced model does not start silently when the limit is exhausted', async () => {
    const st = useStore.getState();
    const sid = st.activeSessionId;
    const ref = 'fal::fal-ai/nopriced';
    const m: ModelSummary = { ref, provider: 'fal', id: 'fal-ai/nopriced', name: 'x', kind: 'image', acceptsText: true, acceptsImage: false, tags: [] } as never;
    const schema: ModelSchema = { ref, params: [], source: 'openapi', slots: { prompt: 'prompt' } };
    const node = { id: 'n', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'N', prompt: 'a cat', modelRef: ref, settings: { count: 1, advanced: {} }, outputIndex: 0 } };
    useStore.setState({
      catalog: { ...st.catalog, models: { [ref]: m }, schemas: { [ref]: schema } },
      settings: { ...useStore.getState().settings, keys: { ...useStore.getState().settings.keys, fal: 'k' } },
      sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: { nodes: [node], edges: [] } as never, feed: [] } },
    });
    await runNodes(sid, ['n']);
    const signalled = execute.mock.calls.length === 0 || toasts().some((t) => /limit/i.test(t));
    expect(signalled).toBe(true);
  });
});
