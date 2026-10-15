import { afterEach, describe, expect, it, vi } from 'vitest';
import { atlas } from '../src/engine/providers/atlas';

const OUT = 'data:image/png;base64,iVBORw0KGgo=';
const job = { provider: 'atlas', id: 'pred_1', meta: {} } as never;
const ctx = (signal = new AbortController().signal) => ({ kind: 'image' as const, apiKey: 'k', signal, onStatus: () => undefined });

/** Atlas answers with these bodies in order; the last one repeats. */
function answers(bodies: Array<Record<string, unknown>>) {
  let i = 0;
  vi.stubGlobal('fetch', async () => {
    const body = bodies[Math.min(i, bodies.length - 1)];
    i++;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return () => i;
}

describe('Atlas completed without outputs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('empty, empty, then with an output: succeeds', async () => {
    vi.useFakeTimers();
    const calls = answers([
      { data: { status: 'completed', outputs: [] } },
      { data: { status: 'completed', outputs: [] } },
      { data: { status: 'completed', outputs: [OUT] } },
    ]);
    const p = atlas.resume!(job, ctx());
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res.outputs.length).toBe(1);
    expect(calls()).toBe(3);
  });

  it('stays empty after the retries: fails as before', async () => {
    vi.useFakeTimers();
    const calls = answers([{ data: { status: 'completed', outputs: [] } }]);
    const p = atlas.resume!(job, ctx());
    const settled = p.then(() => new Error("resolved"), (e: Error) => e);
    await vi.runAllTimersAsync();
    expect((await settled).message).toBe('Atlas Cloud finished without outputs');
    expect(calls()).toBe(4);
  });
});
