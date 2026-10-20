import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { normalizePlan, type PlanContext } from '../src/engine/plan';
import { useStore } from '../src/store/store';
import type { ModelSummary, ModelSchema, ImageStep } from '../src/engine/types';

/* A model the user names in the CURRENT request wins over the confirmed one; never because the plan wanted it. */
const FLUX = 'atlas::bfl/flux-3-klein/text-to-image';
const GROK = 'atlas::xai/grok-imagine-image/text-to-image';
const NAME: Record<string, string> = { [FLUX]: 'FLUX 3 Image Klein', [GROK]: 'Grok Imagine Image' };
const initial = useStore.getState().catalog;
afterEach(() => useStore.setState({ catalog: initial }));

function context(said: string, extra: Partial<PlanContext> = {}): PlanContext {
  const models = Object.fromEntries([FLUX, GROK].map((ref) => [ref, { ref, id: ref.split('::')[1], provider: 'atlas', kind: 'image', name: NAME[ref], acceptsText: true, acceptsImage: false, tags: [] } as ModelSummary]));
  const schemas = Object.fromEntries([FLUX, GROK].map((ref) => [ref, { ref, source: 'catalog', params: [], slots: { prompt: 'prompt' } } as ModelSchema]));
  useStore.setState({ catalog: { ...initial, models, schemas } });
  return {
    workspace: 'chat', getModel: async (ref) => (models[ref] ? { model: models[ref], schema: schemas[ref] } : null),
    defaultModel: () => FLUX, defaultSettings: () => ({}), asset: () => undefined, layer: () => undefined,
    confirmed: () => ({ modelRef: FLUX, needsImage: false, count: 1, aspect: '1:1' }),
    variantModel: (ref) => ref,
    requestText: () => said,
    // The whole history still names Grok (said three requests ago): it must not count.
    userText: () => `quiero grok image imagine\n${said}`,
    ...extra,
  } as PlanContext;
}
const run = (said: string, extra?: Partial<PlanContext>) => normalizePlan({ steps: [{ id: 's1', kind: 'image', model: GROK, prompt: 'A mug' }] }, context(said, extra), 'p');

const ref = (r: { plan?: { steps: unknown[] } | null }, i = 0) => (r.plan?.steps[i] as ImageStep).modelRef;
let CURRENT = '';
const SWITCHED = [{ modelRef: GROK, needsImage: false, count: 1 }, { modelRef: FLUX, needsImage: false, count: 1 }];

describe('user-named model vs confirmed model (outside Direct: refused until the user confirms the switch)', () => {
  it('named in this request: the plan is refused with the exact fix, nothing is swapped', async () => {
    const r = await run('prueba ahora con grok image imagine');
    expect(r.plan).toBeNull();
    expect(r.errors.join(' ')).toContain(`The user named Grok Imagine Image (${GROK}); call confirm_settings for image with model ${GROK} first.`);
  });
  it('not named in this request: the confirmed model wins, as before', async () => {
    const r = await run('otra imagen de una taza');
    expect(ref(r)).toBe(FLUX);
    expect(JSON.stringify(r)).toContain('Grok Imagine Image → FLUX 3 Image Klein (confirmed)');
  });
  it('repeat case: Grok named requests ago (history), current request names none: FLUX, no refusal', async () => {
    const r = await run('hazme otra con la misma luz');
    expect(r.errors).toEqual([]);
    expect(ref(r)).toBe(FLUX);
  });
  it('after the switch is confirmed (Grok added as a part): steps that write Grok keep it, the others keep the confirmed model', async () => {
    CURRENT = 'prueba la azotea con grok image imagine';
    const ctxParts = { confirmedParts: () => SWITCHED };
    const r = await normalizePlan({ steps: [{ id: 's1', kind: 'image', model: GROK, prompt: 'rooftop' }, { id: 's2', kind: 'image', prompt: 'A mug' }, { id: 's3', kind: 'image', model: FLUX, prompt: 'A cup' }] }, context(CURRENT, ctxParts), 'p');
    expect(r.errors).toEqual([]);
    expect([ref(r, 0), ref(r, 1), ref(r, 2)]).toEqual([GROK, FLUX, FLUX]);
  });
  it('named in general ("try now with Grok"): every step that writes Grok keeps it', async () => {
    CURRENT = 'prueba ahora con grok image imagine';
    const r = await normalizePlan({ steps: [{ id: 's1', kind: 'image', model: GROK, prompt: 'a' }, { id: 's2', kind: 'image', model: GROK, prompt: 'b' }] }, context(CURRENT, { confirmedParts: () => SWITCHED }), 'p');
    expect([ref(r, 0), ref(r, 1)]).toEqual([GROK, GROK]);
  });
  it('Direct: no card, the named model is used', async () => {
    const r = await run('prueba ahora con grok image imagine', { confirmed: () => undefined, composerChosen: () => true });
    expect(r.errors).toEqual([]);
    expect(ref(r)).toBe(GROK);
  });
  it('an A/B comparison keeps its own parts', async () => {
    const r = await run('compara flux y grok image imagine', { confirmedParts: () => SWITCHED });
    expect(ref(r)).toBe(GROK);
    expect(JSON.stringify(r)).not.toContain('(confirmed)');
  });
});
