import { describe, expect, it, vi } from 'vitest';

const logged = vi.hoisted(() => [] as Array<{ kind: string; data: Record<string, unknown> }>);
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
vi.mock('../src/lib/log', () => ({ logEvent: (kind: string, data: Record<string, unknown>) => logged.push({ kind, data }), logged: (_: string, f: unknown) => f, logSettled: async () => undefined }));
vi.mock('../src/engine/providers/registry', async (orig) => {
  const real = await orig<typeof import('../src/engine/providers/registry')>();
  return { ...real, ADAPTERS: { ...real.ADAPTERS, atlas: { ...real.ADAPTERS.atlas, resume: async () => { throw new Error('Atlas Cloud: Upstream access denied'); } } } };
});

import { createGeneration, resumeInterrupted } from '../src/engine/jobs';
import { patchGeneration, useStore } from '../src/store/store';

describe('a followed job that fails leaves its trail (P5a)', () => {
  it('logs provider-error after a reload resumes a job that then fails', async () => {
    const st = useStore.getState();
    useStore.setState({ settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'k' } } });
    const ref = 'atlas::google/nano-banana-2-lite/text-to-image';
    const g = createGeneration({ sessionId: st.activeSessionId, kind: 'image', prompt: 'x', modelRef: ref, settings: { count: 1, advanced: {} }, inputs: { refs: [] }, origin: 'composer' });
    patchGeneration(g.id, { status: 'running', remoteJob: { provider: 'atlas', id: 'job_1' } as never });
    await resumeInterrupted();
    await new Promise((r) => setTimeout(r, 20));
    expect(useStore.getState().generations[g.id].status).toBe('error');
    expect(logged.find((l) => l.kind === 'provider-error')?.data).toMatchObject({ generation: g.id, jobId: 'job_1', resumed: true });
  });
});
