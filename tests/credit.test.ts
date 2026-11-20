import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelSummary } from '../src/engine/types';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));

import { useStore } from '../src/store/store';
import { ADAPTERS } from '../src/engine/providers/registry';
import { HttpError } from '../src/lib/http';
import { forgetBalances, isCreditError, onAgentCredit, onGenerationCredit } from '../src/engine/credit';
import { useAlerts } from '../src/engine/alerts';

const m = (provider: 'nanogpt' | 'atlas', id: string, usd: number): ModelSummary =>
  ({ ref: `${provider}::${id}`, provider, id, name: id, kind: 'video', acceptsText: true, acceptsImage: true, tags: [], price: { skus: [{ unit: 'second', usd }] } }) as unknown as ModelSummary;

const setup = (atlasUsd: number, atlasBalance: number, autoSwitchProvider: 'ask' | 'always' | 'never' = 'always') => {
  const nano = m('nanogpt', 'bytedance-seedance-2-0-fast', 0.1);
  const atlas = m('atlas', 'bytedance/seedance-2.0-fast/image-to-video', atlasUsd);
  const other = m('atlas', 'bytedance/seedance-2.0/image-to-video', 0.3);
  const st = useStore.getState();
  useStore.setState({
    settings: { ...st.settings, autoSwitchProvider, keys: { ...st.settings.keys, nanogpt: 'k', atlas: 'k' } },
    catalog: { ...st.catalog, models: { [nano.ref]: nano, [atlas.ref]: atlas, [other.ref]: other } },
    generations: { g1: { id: 'g1', sessionId: st.activeSessionId, kind: 'video', modelRef: nano.ref, modelName: nano.name, status: 'error', inputs: { refs: [] }, settings: { count: 1 }, assetIds: [] } as never },
  });
  vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(atlasBalance);
  useAlerts.setState({ alerts: [] });
  forgetBalances();
};

beforeEach(() => vi.restoreAllMocks());

describe('no credit at the provider', () => {
  it('recognizes the failure', () => {
    expect(isCreditError(new HttpError(402, 'x', null))).toBe(true);
    expect(isCreditError(new Error('Insufficient credits at the provider: Insufficient balance'))).toBe(true);
    expect(isCreditError(new Error('Rate limited'))).toBe(false);
  });

  it('switches to the same model at a provider with credit when it costs the same or less, and says so', async () => {
    setup(0.08, 5);
    const rerun = vi.fn(async () => []);
    expect(await onGenerationCredit('g1', rerun)).toBe(true);
    expect(useStore.getState().generations.g1.modelRef).toBe('atlas::bytedance/seedance-2.0-fast/image-to-video');
    expect(rerun).toHaveBeenCalledWith('g1');
    expect(useStore.getState().generations.g1.provider).toBe('atlas'); // the label follows the model it was switched to
    expect(useAlerts.getState().alerts[0].text).toMatch(/NanoGPT has no credit: .* switched to the same model at Atlas/);
  });

  it('by default it asks first, with the new provider and price, and switches only on "Yes, this time"', async () => {
    setup(0.08, 5, 'ask');
    const rerun = vi.fn(async () => []);
    expect(await onGenerationCredit('g1', rerun)).toBe(false);
    expect(rerun).not.toHaveBeenCalled();
    expect(useStore.getState().generations.g1.modelRef).toBe('nanogpt::bytedance-seedance-2-0-fast');
    const alert = useAlerts.getState().alerts[0];
    expect(alert.text).toMatch(/Run it on Atlas Cloud instead \(.*\$0\.\d+.*same model, same price or less\)\?/);
    expect(alert.actions?.map((a) => a.label)).toEqual(['Yes, this time', 'Don\u2019t ask again']);
    alert.actions![0].run();
    await vi.waitFor(() => expect(rerun).toHaveBeenCalledTimes(1));
    expect(useStore.getState().generations.g1.modelRef).toBe('atlas::bytedance/seedance-2.0-fast/image-to-video');
    expect(useStore.getState().settings.autoSwitchProvider).toBe('ask'); // "this time" does not change the setting
  });

  it('"Don\u2019t ask again" switches now and from then on switches by itself', async () => {
    setup(0.08, 5, 'ask');
    const rerun = vi.fn(async () => []);
    await onGenerationCredit('g1', rerun);
    useAlerts.getState().alerts[0].actions![1].run();
    await vi.waitFor(() => expect(rerun).toHaveBeenCalledTimes(1));
    expect(useStore.getState().settings.autoSwitchProvider).toBe('always');
  });

  it('"never" does not switch by itself: only the manual choices', async () => {
    setup(0.08, 5, 'never');
    const rerun = vi.fn(async () => []);
    expect(await onGenerationCredit('g1', rerun)).toBe(false);
    expect(rerun).not.toHaveBeenCalled();
    expect(useAlerts.getState().alerts[0].text).toMatch(/Run it with another model that has credit/);
  });

  it('never switches by itself to a dearer model: it offers the choices above the prompt box', async () => {
    setup(0.14, 5);
    const rerun = vi.fn(async () => []);
    expect(await onGenerationCredit('g1', rerun)).toBe(false);
    expect(rerun).not.toHaveBeenCalled();
    expect(useStore.getState().generations.g1.modelRef).toBe('nanogpt::bytedance-seedance-2-0-fast');
    const alert = useAlerts.getState().alerts[0];
    expect(alert.level).toBe('warn');
    expect(alert.actions?.length).toBeGreaterThan(0);
  });

  it('with no provider with credit: asks to recharge', async () => {
    setup(0.08, 0);
    expect(await onGenerationCredit('g1', async () => [])).toBe(false);
    expect(useAlerts.getState().alerts[0]).toMatchObject({ level: 'error' });
    expect(useAlerts.getState().alerts[0].text).toMatch(/Recharge NanoGPT/);
  });
});

describe('the equivalent model when a provider has no credit', () => {
  const img = (provider: 'nanogpt' | 'atlas', id: string, usd: number, acceptsImage: boolean): ModelSummary =>
    ({ ref: `${provider}::${id}`, provider, id, name: id, kind: 'image', acceptsText: true, acceptsImage, tags: [], price: { skus: [{ unit: 'output', usd }] } }) as unknown as ModelSummary;

  const run = async (models: ModelSummary[], failing: ModelSummary, inputs: Record<string, unknown> = { refs: [] }) => {
    const st = useStore.getState();
    useStore.setState({
      settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k', atlas: 'k' } },
      catalog: { ...st.catalog, models: Object.fromEntries(models.map((x) => [x.ref, x])) },
      generations: { g1: { id: 'g1', sessionId: st.activeSessionId, kind: 'image', modelRef: failing.ref, modelName: failing.name, status: 'error', inputs, settings: { count: 1 }, assetIds: [] } as never },
    });
    vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(0);
    vi.spyOn(ADAPTERS.nanogpt, 'balance').mockResolvedValue(5);
    useAlerts.setState({ alerts: [] });
    forgetBalances();
    const rerun = vi.fn(async () => []);
    return { rerun, switched: await onGenerationCredit('g1', rerun) };
  };

  it('a text-only model switches to the image-capable copy of the same line, which can run the text job', async () => {
    const atlas = img('atlas', 'google/nano-banana-2/text-to-image', 0.07, false);
    const nano = img('nanogpt', 'nano-banana-2', 0.06, true);
    const pro = img('nanogpt', 'nano-banana-pro', 0.14, true);
    const { switched, rerun } = await run([atlas, nano, pro], atlas);
    expect(switched).toBe(true);
    expect(useStore.getState().generations.g1.modelRef).toBe('nanogpt::nano-banana-2');
    expect(rerun).toHaveBeenCalledWith('g1');
  });

  it('never switches an image job to a model that takes no image', async () => {
    const atlas = img('atlas', 'google/nano-banana-2/edit', 0.07, true);
    const nano = img('nanogpt', 'nano-banana-2', 0.06, false);
    const { switched } = await run([atlas, nano], atlas, { refs: ['asset-1'] });
    expect(switched).toBe(false);
    expect(useAlerts.getState().alerts[0].level).toBe('error');
  });

  it('F-06: a text-only job (no references) may use a text-only equivalent, even if the failed model also takes images', async () => {
    const atlas = img('atlas', 'google/nano-banana-2/edit', 0.07, true);
    const nano = img('nanogpt', 'nano-banana-2', 0.06, false);
    const { switched, rerun } = await run([atlas, nano], atlas, { refs: [] });
    expect(switched).toBe(true);
    expect(useStore.getState().generations.g1.modelRef).toBe('nanogpt::nano-banana-2');
    expect(rerun).toHaveBeenCalledWith('g1');
  });

  it('F-06: a job whose only input is a first frame rejects a text-only equivalent too', async () => {
    const atlas = img('atlas', 'google/nano-banana-2/edit', 0.07, true);
    const nano = img('nanogpt', 'nano-banana-2', 0.06, false);
    expect((await run([atlas, nano], atlas, { refs: [], firstFrame: 'asset-1' })).switched).toBe(false);
  });

  it('does not offer a family member far dearer than the failed model; a slightly dearer one is marked', async () => {
    const atlas = img('atlas', 'google/nano-banana-2/text-to-image', 0.1, false);
    const pro = img('nanogpt', 'nano-banana-pro', 0.25, true);
    const lite = img('nanogpt', 'nano-banana-2-lite', 0.13, true);
    const { switched } = await run([atlas, pro, lite], atlas);
    expect(switched).toBe(false);
    const labels = (useAlerts.getState().alerts[0].actions ?? []).map((a) => a.label);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatch(/nano-banana-2-lite.*pricier/);
  });

  it('when the only equivalent was dropped for its price, the alert says so instead of claiming there is none', async () => {
    const atlas = img('atlas', 'google/nano-banana-2/text-to-image', 0.1, false);
    const pro = img('nanogpt', 'nano-banana-pro', 0.25, true);
    const { switched } = await run([atlas, pro], atlas);
    expect(switched).toBe(false);
    const alert = useAlerts.getState().alerts[0];
    expect(alert.level).toBe('error');
    expect(alert.text).toContain('has a similar model (nano-banana-pro) but it costs 2.5× more, so it is not offered automatically');
    expect(alert.text).not.toContain('no other connected provider');
    expect(alert.actions ?? []).toHaveLength(0);
  });
});

describe('B11: the credit switch compares what this job costs, not the first listed price', () => {
  it('a 1080p job switches to a provider whose flat price is under the failed model\'s 1080p price', async () => {
    const nano = { ...m('nanogpt', 'bytedance-seedance-2-0-fast', 0.1), price: { skus: [{ unit: 'second', usd: 0.1, resolution: '480p' }, { unit: 'second', usd: 0.3, resolution: '1080p' }] } } as ModelSummary;
    const atlas = m('atlas', 'bytedance/seedance-2.0-fast/image-to-video', 0.2);
    const st = useStore.getState();
    useStore.setState({
      settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k', atlas: 'k' } },
      catalog: { ...st.catalog, models: { [nano.ref]: nano, [atlas.ref]: atlas }, schemas: {} },
      generations: { g1: { id: 'g1', sessionId: st.activeSessionId, kind: 'video', modelRef: nano.ref, modelName: nano.name, status: 'error', inputs: { refs: [] }, settings: { count: 1, duration: 5, resolution: '1080p', advanced: {} }, assetIds: [] } as never },
    });
    vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(10);
    useAlerts.setState({ alerts: [] });
    forgetBalances();
    const rerun = vi.fn(async () => []);
    expect(await onGenerationCredit('g1', rerun)).toBe(true);
    expect(useStore.getState().generations.g1.modelRef).toBe(atlas.ref);
  });
});

describe('the agent\u2019s own credit follows the same setting', () => {
  const llm = (id: string, name: string, inputPrice?: number, outputPrice?: number) => ({ id, name, tools: true, vision: true, inputPrice, outputPrice }) as never;
  const prep = (mode: 'ask' | 'always' | 'never', priced = true) => {
    const st = useStore.getState();
    useStore.setState({
      settings: { ...st.settings, autoSwitchProvider: mode, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'a' }, keys: { ...st.settings.keys, nanogpt: 'k', openrouter: 'k' } },
      catalog: { ...st.catalog, llm: { ...st.catalog.llm, nanogpt: [llm('a', 'Model A', priced ? 1 : undefined, priced ? 1 : undefined)], openrouter: [llm('b', 'Model A', priced ? 1 : undefined, priced ? 1 : undefined)] } },
    });
    useAlerts.setState({ alerts: [] });
    forgetBalances();
  };
  it('ask: asks, and switches only on "Yes, this time"', async () => {
    prep('ask');
    expect(await onAgentCredit()).toBe(false);
    expect(useStore.getState().settings.agent.provider).toBe('nanogpt');
    useAlerts.getState().alerts[0].actions![0].run();
    expect(useStore.getState().settings.agent.provider).toBe('openrouter');
  });
  it('never: does not switch by itself', async () => {
    prep('never');
    expect(await onAgentCredit()).toBe(false);
    expect(useStore.getState().settings.agent.provider).toBe('nanogpt');
  });
  it('always: switches', async () => {
    prep('always');
    expect(await onAgentCredit()).toBe(true);
    expect(useStore.getState().settings.agent.provider).toBe('openrouter');
  });
  it('unknown prices are not "same price or less"', async () => {
    prep('always', false);
    expect(await onAgentCredit()).toBe(false);
    expect(useStore.getState().settings.agent.provider).toBe('nanogpt');
  });
});
