import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { checkingPlan, watchModel } from '../src/engine/agent/turnStop';
import { MIN_SAMPLES, median, recordSchemaLoad, resetSchemaSamples, typicalSchemaLoad, waitDetail, waitHooks, type PendingWait } from '../src/engine/agent/schemaWait';
import { useStore } from '../src/store/store';

const REF = 'nanogpt::grok-video';

/** A fake agent state and the action log the hooks write to. */
function harness() {
  const state: { waiting?: PendingWait[] } = {};
  const actions: Array<{ icon: string; label: string; detail: string }> = [];
  const hooks = waitHooks({
    patch: (fn) => Object.assign(state, fn(state)),
    action: (entry) => actions.push(entry),
  });
  return { state, actions, hooks };
}

beforeEach(() => {
  resetSchemaSamples();
  useStore.setState((s) => ({ catalog: { ...s.catalog, schemas: {} } }) as never);
});

describe('schema wait helpers', () => {
  it('median of the samples', () => {
    expect(median([])).toBeUndefined();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('the usual time appears only after enough real samples', () => {
    for (let i = 0; i < MIN_SAMPLES - 1; i++) recordSchemaLoad(2000);
    expect(typicalSchemaLoad()).toBeUndefined();
    expect(waitDetail('Grok', 1000)).toBe('Grok · 1s');
    recordSchemaLoad(2000);
    expect(typicalSchemaLoad()).toBe(2000);
    expect(waitDetail('Grok', 1000)).toBe('Grok · 1s · usually ~2s');
  });

  it('"taking longer" starts only past twice the usual time', () => {
    for (let i = 0; i < MIN_SAMPLES; i++) recordSchemaLoad(2000);
    expect(waitDetail('Grok', 4000)).toBe('Grok · 4s · usually ~2s');
    expect(waitDetail('Grok', 4500)).toBe('Grok · 5s · usually ~2s, taking longer');
  });
});

describe('the waiting state around a schema load', () => {
  it('is set while the schema loads and cleared when it arrives, with a real duration', async () => {
    const { state, actions, hooks } = harness();
    let finish!: (v: unknown) => void;
    const lookup = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const ctrl = new AbortController();
    const turn = checkingPlan('w1', ctrl.signal, async () => watchModel('w1', lookup as never)(REF), hooks);

    expect(state.waiting).toHaveLength(1);
    expect(state.waiting?.[0]).toMatchObject({ key: REF, name: 'grok-video' });
    expect(actions).toEqual([]);

    finish({ model: { name: 'Grok' }, schema: { source: 'loaded' } });
    await turn;
    expect(state.waiting).toEqual([]);
    expect(actions).toEqual([{ icon: 'schema', label: 'Schema loaded', detail: 'grok-video · 1s' }]);
    expect(typicalSchemaLoad()).toBeUndefined(); // one sample is not yet a usual time
  });

  it('a schema that comes back derived is reported as unavailable and is not a sample', async () => {
    const { state, actions, hooks } = harness();
    const ctrl = new AbortController();
    const turn = checkingPlan('w2', ctrl.signal, async () => watchModel('w2', async () => ({ model: { name: 'Grok' } as never, schema: { source: 'derived' } as never }))(REF), hooks);
    await turn;
    expect(state.waiting).toEqual([]);
    expect(actions.map((a) => a.label)).toEqual(['Schema unavailable']);
    recordSchemaLoad(0); // only real loads count
    expect(typicalSchemaLoad()).toBeUndefined();
  });

  it('a schema already in the cache is no wait', async () => {
    useStore.setState((s) => ({ catalog: { ...s.catalog, schemas: { [REF]: { source: 'nanogpt' } as never } } }) as never);
    const { state, actions, hooks } = harness();
    const ctrl = new AbortController();
    await checkingPlan('w3', ctrl.signal, async () => watchModel('w3', async () => ({ model: { name: 'Grok' } as never, schema: { source: 'nanogpt' } as never }))(REF), hooks);
    expect(state.waiting).toBeUndefined();
    expect(actions).toEqual([]);
  });

  it('after Stop a late schema load writes nothing', async () => {
    const { state, actions, hooks } = harness();
    let finish!: (v: unknown) => void;
    const lookup = () => new Promise((resolve) => { finish = resolve; });
    const ctrl = new AbortController();
    const turn = checkingPlan('w4', ctrl.signal, async () => watchModel('w4', lookup as never)(REF), hooks);
    ctrl.abort();
    await expect(turn).rejects.toThrow();
    finish({ model: { name: 'Grok' }, schema: { source: 'loaded' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(actions).toEqual([]);
    expect(state.waiting).toHaveLength(1); // the turn's end clears it, not the late load
  });
});
