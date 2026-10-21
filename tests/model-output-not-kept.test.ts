import { afterEach, describe, expect, it, vi } from 'vitest';

/* A 3D result that cannot be downloaded raises the one-per-reason warning, like every other result (keepResult.ts). */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async (id: string) => id,
}));

import { storeModelOutputs } from '../src/engine/jobs';
import { useAlerts } from '../src/engine/alerts';
import type { Generation } from '../src/engine/types';

afterEach(() => { vi.unstubAllGlobals(); useAlerts.setState({ alerts: [] }); });

describe('3D results that cannot be kept', () => {
  it('warns once, keeps the remote link and does not fail the job', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('gone', { status: 410 })));
    const assets = await storeModelOutputs([{ url: 'https://ark-content.volces.com/m.glb', mime: 'model/gltf-binary' }], { id: 'g1', sessionId: 's1' } as unknown as Generation);
    expect(assets).toHaveLength(1);
    expect(assets[0].stored).toBe(false);
    expect(assets[0].remoteUrl).toBe('https://ark-content.volces.com/m.glb');
    const alerts = useAlerts.getState().alerts;
    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toBe('warn');
    expect(alerts[0].text).toContain('could not be saved on this computer');
  });
});
