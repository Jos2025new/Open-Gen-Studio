// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
const runLayerOp = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../src/engine/actions', async (orig) => ({
  ...(await orig<typeof import('../src/engine/actions')>()),
  runLayerOp,
  layerOpEstimate: async () => { throw new Error('No price for this model'); },
}));

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useOpRun, type OpRun } from '../src/components/assets/opRun';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useOpRun on a layer whose estimate fails', () => {
  it('settles with an unknown cost (to confirm), instead of staying blocked on "Calculating…"', async () => {
    let state: OpRun | undefined;
    const Probe = () => { state = useOpRun('upscale', { kind: 'layer', sessionId: 's', docId: 'd', layerId: 'l' }); return null; };
    const root = createRoot(document.createElement('div'));
    await act(async () => { root.render(createElement(Probe)); });
    expect(state!.blocked).toBe('Calculating the cost…');
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(state!.blocked).toBeNull();
    expect(state!.estimate).toMatchObject({ usd: null, note: 'No price for this model' });
    state!.run();
    expect(runLayerOp).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
