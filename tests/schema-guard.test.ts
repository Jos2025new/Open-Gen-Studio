import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * A model whose real parameter schema could not be loaded ("derived") must never be sent a paid request: the body
 * built from it lacked the prompt (real case: Atlas "GPT Image 2 Developer Edit", "field <image> is required").
 * Provider adapters are mocked and fetch is stubbed: nothing reaches a provider.
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
const ctl = vi.hoisted(() => ({ loadFailures: 0, loads: 0, generated: 0 }));
vi.mock('../src/engine/providers/registry', async (orig) => {
  const real = await orig<typeof import('../src/engine/providers/registry')>();
  return {
    ...real,
    ADAPTERS: {
      ...real.ADAPTERS,
      atlas: {
        ...real.ADAPTERS.atlas,
        loadSchema: async (m: { ref: string }) => {
          ctl.loads++;
          if (ctl.loadFailures > 0) { ctl.loadFailures--; throw new Error('Atlas Cloud has no schema for ' + m.ref); }
          return { ref: m.ref, params: [], slots: { prompt: 'prompt', images: { key: 'image', max: 1, min: 0, multiple: false, format: 'url' } }, source: 'openapi' };
        },
        generate: async () => { ctl.generated++; return { outputs: [{ blob: new Blob(['x'], { type: 'image/png' }), mime: 'image/png' }] }; },
      },
    },
  };
});

import { createGeneration, retryGeneration, runGeneration } from '../src/engine/jobs';
import { ensureSchema } from '../src/engine/catalog';
import { derivedSchemaErrors, resolveSendable, SchemaUnavailableError } from '../src/engine/schemaGuard';
import { failedStepSummary } from '../src/engine/agent/failureContext';
import { previewRun } from '../src/engine/flow/actions';
import { extractErrorMessage } from '../src/lib/http';
import { useStore } from '../src/store/store';
import type { ModelSummary } from '../src/engine/types';

const REF = 'atlas::openai/gpt-image-2/developer/edit';
const model = { id: 'openai/gpt-image-2/developer/edit', ref: REF, name: 'GPT Image 2 Developer Edit', provider: 'atlas', kind: 'image', acceptsText: true, acceptsImage: true, tags: [] } as unknown as ModelSummary;
let fetched = 0;
beforeEach(() => {
  ctl.loadFailures = 99; ctl.loads = 0; ctl.generated = 0; fetched = 0;
  vi.stubGlobal('fetch', async () => { fetched++; return new Response('{}', { status: 503 }); });
  const st = useStore.getState();
  useStore.setState({ settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'k' } }, catalog: { ...st.catalog, models: { [REF]: model }, schemas: {} } });
});
afterEach(() => vi.unstubAllGlobals());

const spec = (extra: Record<string, unknown> = {}) => ({ sessionId: useStore.getState().activeSessionId, kind: 'image' as const, prompt: 'a cat', modelRef: REF, settings: { count: 1, advanced: {} }, inputs: { refs: [] }, origin: 'agent' as const, ...extra });
const refused = async (id: string) => {
  const err = await runGeneration(id).catch((e: Error) => e);
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toMatch(/GPT Image 2 Developer Edit/);
  expect((err as Error).message).toMatch(/parameters could not be loaded from Atlas/);
  expect((err as Error).message).toMatch(/Atlas Cloud has no schema for/);
  expect(ctl.generated).toBe(0);
  expect(fetched).toBe(0);
  expect(useStore.getState().generations[id].status).toBe('error');
};

describe('schema guard: no paid request with a derived schema', () => {
  it('direct generation is refused with the model, the cause and no charge', async () => {
    await refused(createGeneration(spec()).id);
    expect(ctl.loads).toBeGreaterThanOrEqual(2); // the load was tried again before refusing
  });

  it('Retry after a failure is refused the same way', async () => {
    const first = createGeneration(spec());
    await runGeneration(first.id).catch(() => undefined);
    useStore.setState((s) => ({ generations: { ...s.generations, [first.id]: { ...s.generations[first.id], status: 'error' } } }));
    const err = await retryGeneration(first.id).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/could not be loaded/);
    expect(ctl.generated).toBe(0);
  });

  it('an agent plan step is refused', async () => {
    await refused(createGeneration(spec({ planId: 'p1', stepId: 's1', origin: 'agent' })).id);
  });

  it('an operation (relight / edit) is refused', async () => {
    await refused(createGeneration(spec({ op: { id: 'relight', params: {}, sourceAssetId: 'ast_x' } })).id);
  });

  it('a node-flow generation is refused', async () => {
    await refused(createGeneration(spec({ origin: 'node' as never })).id);
  });

  it('a video generation is refused', async () => {
    const vref = 'atlas::vendor/clip/image-to-video';
    useStore.setState((s) => ({ catalog: { ...s.catalog, models: { ...s.catalog.models, [vref]: { ...model, id: 'vendor/clip/image-to-video', ref: vref, kind: 'video', name: 'Clip I2V' } as ModelSummary } } }));
    const g = createGeneration(spec({ kind: 'video', modelRef: vref }));
    const err = await runGeneration(g.id).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/Clip I2V/);
    expect(ctl.generated).toBe(0);
  });

  it('when the load recovers on the second try, the request is sent with the real schema', async () => {
    ctl.loadFailures = 1;
    const g = createGeneration(spec());
    await runGeneration(g.id);
    expect(ctl.generated).toBe(1);
    expect(useStore.getState().catalog.schemas[REF].source).toBe('openapi');
  });

  it('a derived schema is not cached for good: the next ensureSchema loads the real one', async () => {
    ctl.loadFailures = 1;
    const first = await ensureSchema(REF);
    expect(first?.source).toBe('derived');
    expect(first?.loadError).toMatch(/no schema/);
    const second = await ensureSchema(REF);
    expect(second?.source).toBe('openapi');
    expect(useStore.getState().catalog.schemas[REF].source).toBe('openapi');
    expect(await ensureSchema(REF)).toBe(second); // a real one is cached
    expect(ctl.loads).toBe(2);
  });

  it('concurrent ensureSchema calls share one load', async () => {
    await Promise.all([ensureSchema(REF), ensureSchema(REF), ensureSchema(REF)]);
    expect(ctl.loads).toBe(1);
  });

  it('resolveSendable throws SchemaUnavailableError', async () => {
    await expect(resolveSendable(REF)).rejects.toBeInstanceOf(SchemaUnavailableError);
  });

  it('a plan step with a derived schema is flagged before any price', async () => {
    const getModel = async () => ({ model, schema: { ref: REF, params: [], slots: {}, source: 'derived' as const, loadError: 'boom' } });
    const errors = await derivedSchemaErrors([{ id: 's1', kind: 'image', modelRef: REF }, { id: 's2', kind: 'op', params: { _modelRef: REF } }], getModel);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/^s1: GPT Image 2 Developer Edit.*could not be loaded from Atlas.*boom.*Not priced/);
  });

  it('the node preview flags it too', () => {
    const st = useStore.getState(), sid = st.activeSessionId;
    const graph = { nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'N1', modelRef: REF, prompt: 'x', settings: { count: 1, advanced: {} } } }], edges: [] } as never;
    useStore.setState({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph } }, catalog: { ...st.catalog, schemas: { [REF]: { ref: REF, params: [], slots: {}, source: 'derived', loadError: 'boom' } } } });
    expect(previewRun(sid, ['n1']).errors.join(' ')).toMatch(/GPT Image 2 Developer Edit.*could not be loaded/);
  });
});

describe('failure context for the agent', () => {
  it('names the model, ref, provider, schema source and the raw provider error', () => {
    const st = useStore.getState(), sid = st.activeSessionId;
    const raw = 'request body field <image> is required [Atlas code 400]';
    useStore.setState({
      generations: { g1: { id: 'g1', modelRef: REF, modelName: 'GPT Image 2 Developer Edit', provider: 'atlas' } as never },
      catalog: { ...st.catalog, schemas: { [REF]: { ref: REF, params: [], slots: {}, source: 'derived' } } },
      sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [{ id: 'it1', type: 'plan', stepGenerations: { s1: 'g1' } } as never] } },
    });
    const text = failedStepSummary(sid, 'it1', 's1', raw);
    expect(text).toContain('GPT Image 2 Developer Edit');
    expect(text).toContain(REF);
    expect(text).toContain('atlas');
    expect(text).toContain('schema: derived');
    expect(text).toContain(raw);
  });

  it('falls back to the plain line when no generation exists', () => {
    expect(failedStepSummary(useStore.getState().activeSessionId, 'none', 's9', 'boom')).toBe('s9 failed (boom)');
  });

  it('the procedure tells the agent that a "required" error means the app built the request wrong', async () => {
    const { WORK_RULES } = await import('../src/engine/procedure');
    expect(WORK_RULES).toMatch(/required, missing or invalid.*app built the request wrongly/);
  });
});

describe('provider error text is not lost', () => {
  it('a validation list keeps the field and every message', () => {
    const body = { detail: [{ loc: ['body', 'image'], msg: 'Field required' }, { loc: ['body', 'prompt'], msg: 'Field required' }] };
    const msg = extractErrorMessage(body, 'x');
    expect(msg).toContain('image');
    expect(msg).toContain('prompt');
  });
  it('an error object without message is kept as text', () => {
    expect(extractErrorMessage({ error: { code: 1013002, reason: 'Upstream access denied' } }, 'x')).toContain('Upstream access denied');
  });
});
