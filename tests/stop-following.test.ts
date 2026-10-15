import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
vi.mock('../src/lib/log', () => ({ logEvent: () => undefined, logged: (_: string, f: unknown) => f, logSettled: async () => undefined }));
vi.mock('../src/engine/providers/registry', async (orig) => {
  const real = await orig<typeof import('../src/engine/providers/registry')>();
  // A job the provider keeps running: the follower waits until the app stops it.
  const waitForStop = (_job: unknown, ctx: { signal: AbortSignal }) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  return { ...real, ADAPTERS: { ...real.ADAPTERS, atlas: { ...real.ADAPTERS.atlas, resume: waitForStop } } };
});

import { cancelGeneration, createGeneration, resumeInterrupted } from '../src/engine/jobs';
import { patchGeneration, useStore } from '../src/store/store';

const ref = 'atlas::google/nano-banana-2-lite/text-to-image';
const make = () => {
  const st = useStore.getState();
  useStore.setState({ settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'k' } } });
  return createGeneration({ sessionId: st.activeSessionId, kind: 'image', prompt: 'x', modelRef: ref, settings: { count: 1, advanced: {} }, inputs: { refs: [] }, origin: 'composer' });
};

describe('Stop before and after the job is submitted', () => {
  it('Stop while queued cancels the generation', () => {
    const g = make();
    patchGeneration(g.id, { status: 'queued' });
    cancelGeneration(g.id);
    expect(useStore.getState().generations[g.id].status).toBe('canceled');
  });

  it('Dejar de seguir after submit keeps the remote job so Check status can resume it', async () => {
    const g = make();
    patchGeneration(g.id, { status: 'running', remoteJob: { provider: 'atlas', id: 'job_9' } as never });
    await resumeInterrupted();
    cancelGeneration(g.id);
    await new Promise((r) => setTimeout(r, 20));
    const after = useStore.getState().generations[g.id];
    expect(after.status).toBe('canceled');
    expect(after.remoteJob).toMatchObject({ id: 'job_9' });
  });
});
