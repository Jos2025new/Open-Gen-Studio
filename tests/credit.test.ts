import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelSummary } from '../src/engine/types';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));

import { useStore } from '../src/store/store';
import { ADAPTERS } from '../src/engine/providers/registry';
import { HttpError } from '../src/lib/http';
import { forgetBalances, isCreditError, onGenerationCredit } from '../src/engine/credit';
import { useAlerts } from '../src/engine/alerts';

const m = (provider: 'nanogpt' | 'atlas', id: string, usd: number): ModelSummary =>
  ({ ref: `${provider}::${id}`, provider, id, name: id, kind: 'video', acceptsText: true, acceptsImage: true, tags: [], price: { skus: [{ unit: 'second', usd }] } }) as unknown as ModelSummary;

const setup = (atlasUsd: number, atlasBalance: number) => {
  const nano = m('nanogpt', 'bytedance-seedance-2-0-fast', 0.1);
  const atlas = m('atlas', 'bytedance/seedance-2.0-fast/image-to-video', atlasUsd);
  const other = m('atlas', 'bytedance/seedance-2.0/image-to-video', 0.3);
  const st = useStore.getState();
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k', atlas: 'k' } },
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
    expect(useAlerts.getState().alerts[0].text).toMatch(/NanoGPT has no credit: .* switched to the same model at Atlas/);
  });

  it('never switches by itself to a dearer model: it offers the choices above the prompt box', async () => {
    setup(0.2, 5);
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
